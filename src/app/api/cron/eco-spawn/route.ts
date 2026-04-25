/**
 * Basement v0.5 / Phase G — ECO event-driven spawn cron.
 *
 * Runs once per day (Vercel cron `0 13 * * *`). Walks `eco_event_calendar`
 * for entries within the spawn-ahead window (default 7 days) whose status
 * is "scheduled", and creates corresponding `cases_v3` rows under the
 * matching `series_v3` row.
 *
 * Design notes (per CLAUDE.md "v0 托管模型"):
 *   - ECO is fully DB-AMM. NO on-chain market_factory call. The `caseVault`
 *     code path is reserved for v1; v0 keeps ECO in Postgres only.
 *   - series_v3 row for an ECO series is lazy-upserted on first spawn (we
 *     do NOT pre-seed it because the schema strongly couples seriesV3 with
 *     pythFeedId / cadence which are placeholder for ECO until Phase F).
 *   - Calendar is the source of truth for which events to spawn for; spawn
 *     is idempotent via UNIQUE(case PK = (seriesId, roundIdx)) where
 *     roundIdx = release_time_sec.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";

import { db } from "@/db";
import { casesV3, ecoEventCalendar, seriesV3 } from "@/db/schema";
import {
  ECO_SERIES_CONFIG,
  getEcoSeriesByEventType,
  type EcoSeriesConfig,
} from "@/lib/series-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SpawnReport {
  nowSec: number;
  scanned: number;
  spawned: Array<{
    eventType: string;
    seriesId: string;
    roundIdx: number;
    releaseTimeSec: number;
    closeTimeSec: number;
  }>;
  skipped: Array<{
    eventType: string;
    releaseTimeSec: number;
    reason: string;
  }>;
  errors: Array<{ eventType?: string; error: string }>;
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const report: SpawnReport = {
    nowSec,
    scanned: 0,
    spawned: [],
    skipped: [],
    errors: [],
  };

  // Spawn-ahead horizon: max(spawnAheadSec) across all configured ECO series.
  // Slightly over-fetch is fine; we filter per-series afterwards.
  const maxSpawnAheadSec = ECO_SERIES_CONFIG.reduce(
    (acc, s) => Math.max(acc, s.eventDriven.spawnAheadSec),
    7 * 86400,
  );
  const cutoff = nowSec + maxSpawnAheadSec;

  // Pull all calendar entries due to spawn (status='scheduled' & release_time
  // < now + cutoff). We deliberately leave entries with release_time < now
  // visible too — eco-settle handles the late-spawn case (case is born CLOSED).
  const due = await db
    .select()
    .from(ecoEventCalendar)
    .where(
      and(
        eq(ecoEventCalendar.status, "scheduled"),
        lt(ecoEventCalendar.releaseTimeSec, cutoff),
      ),
    );
  report.scanned = due.length;

  for (const evt of due) {
    try {
      const series = getEcoSeriesByEventType(evt.eventType);
      if (!series) {
        report.skipped.push({
          eventType: evt.eventType,
          releaseTimeSec: evt.releaseTimeSec,
          reason: "no series config for event_type",
        });
        continue;
      }

      // Per-series spawn-ahead window. Entry only spawns once we are within
      // its individual `spawnAheadSec` of the release.
      const releaseSec = evt.releaseTimeSec;
      if (releaseSec - nowSec > series.eventDriven.spawnAheadSec) {
        // Too early — wait for a future cron run.
        continue;
      }

      // Lazy upsert seriesV3 row so the FK from cases_v3 holds.
      await ensureSeriesRow(series);

      const roundIdx = releaseSec; // release time doubles as round_idx (unique)
      const closeTimeSec = releaseSec - series.eventDriven.freezeBeforeReleaseSec;
      const startTimeSec = nowSec;
      const freezeAtSec = closeTimeSec; // alias — same instant
      const strikePriceE8 = lookupPreviousReleasePriceE8(series);

      const inserted = await db
        .insert(casesV3)
        .values({
          seriesId: series.seriesId,
          roundIdx,
          startTimeSec,
          closeTimeSec,
          strikePriceE8,
          // strikeCents is for USD price feeds; ECO % feeds keep this null
          // until Phase F adds proper percent rendering. Readers tolerate null.
          strikeCents: null,
          state: "OPEN",
          strikeKindCaptured:
            series.eventDriven.direction === "ABOVE"
              ? "absolute_above"
              : "absolute_below",
          releaseTimeSec: releaseSec,
          freezeAtSec,
        })
        .onConflictDoNothing()
        .returning({ roundIdx: casesV3.roundIdx });

      if (inserted.length === 0) {
        report.skipped.push({
          eventType: evt.eventType,
          releaseTimeSec: releaseSec,
          reason: "case already exists for (series, releaseTimeSec)",
        });
        // Still mark calendar status forward so we don't keep re-scanning.
        await db
          .update(ecoEventCalendar)
          .set({
            status: "spawned",
            spawnedSeriesId: series.seriesId,
            spawnedRoundIdx: roundIdx,
          })
          .where(eq(ecoEventCalendar.id, evt.id));
        continue;
      }

      // Mark the calendar row spawned.
      await db
        .update(ecoEventCalendar)
        .set({
          status: "spawned",
          spawnedSeriesId: series.seriesId,
          spawnedRoundIdx: roundIdx,
        })
        .where(eq(ecoEventCalendar.id, evt.id));

      report.spawned.push({
        eventType: evt.eventType,
        seriesId: series.seriesId,
        roundIdx,
        releaseTimeSec: releaseSec,
        closeTimeSec,
      });
    } catch (err) {
      report.errors.push({
        eventType: evt.eventType,
        error: (err as Error).message,
      });
    }
  }

  return NextResponse.json(report);
}

// ───────────────────── helpers ─────────────────────

/**
 * v0 stub: returns the strike threshold to use when spawning.
 * For `strikeSource = "hardcoded"` we just return `strikeValueRaw`.
 * Other sources will be wired in Phase G+ (consensus API, previous_release
 * lookup against `cases_v3.actualReleasedPriceE8`).
 */
function lookupPreviousReleasePriceE8(series: EcoSeriesConfig): bigint {
  const ed = series.eventDriven;
  if (ed.strikeSource === "hardcoded") {
    if (ed.strikeValueRaw == null) {
      throw new Error(
        `series ${series.seriesId}: strikeSource=hardcoded but strikeValueRaw missing`,
      );
    }
    return ed.strikeValueRaw;
  }
  // TODO Phase G+: implement "previous_release" + "consensus_static". For
  // now fall back to strikeValueRaw if present, else throw so we don't
  // silently spawn cases at strike=0.
  if (ed.strikeValueRaw != null) return ed.strikeValueRaw;
  throw new Error(
    `series ${series.seriesId}: strikeSource=${ed.strikeSource} not implemented`,
  );
}

/**
 * Lazy-upsert the seriesV3 row for an ECO series. Idempotent.
 * cadenceSec is stored as 0 (event-driven, not cadence-driven). pmAmmLDollars
 * + kind + eventType are persisted so callers (e.g. /api/quote) can pick up
 * the correct L parameter and route via the right code path.
 */
async function ensureSeriesRow(series: EcoSeriesConfig): Promise<void> {
  await db
    .insert(seriesV3)
    .values({
      seriesId: series.seriesId,
      assetSymbol: series.assetSymbol,
      pair: series.pair,
      category: series.category,
      cadenceSec: series.cadenceSec, // 0 for ECO
      pythFeedId: series.pythFeedId,
      seriesStartSec: series.seriesStartSec,
      marketHoursGated: series.marketHoursGated ? 1 : 0,
      feeBps: series.feeBps,
      sortOrder: series.sortOrder,
      isActive: 1,
      kind: series.kind, // "event_driven"
      eventType: series.eventDriven.eventType,
      pmAmmLDollars: series.pmAmmLDollars ?? null,
      strikeKind:
        series.eventDriven.direction === "ABOVE"
          ? "absolute_above"
          : "absolute_below",
    })
    .onConflictDoNothing();
}
