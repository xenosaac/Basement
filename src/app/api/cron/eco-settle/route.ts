/**
 * Basement v0.5 / Phase G — ECO event-driven settle cron.
 *
 * Runs every 5 minutes (Vercel cron `*\/5 * * * *`). Walks `cases_v3` rows
 * where:
 *   - state = OPEN
 *   - series.kind = 'event_driven'
 *   - releaseTimeSec ≤ now
 *
 * For each, fetches a fresh Pyth tick, runs `computeEcoOutcome`, and:
 *   - writeDb=false (pre_release_tick) → leave OPEN, retry next pass
 *   - writeDb=true, outcome=UP|DOWN    → cases.state = RESOLVED + share×outcome
 *   - writeDb=true, outcome=INVALID    → cases.state = VOID + cost-basis refund
 *
 * Resolution path:
 *   - Share-based settle copies the rolling tick/route.ts pattern: outcome
 *     decides which side's shares are worth $1.00 (winning) or $0 (losing).
 *     Position rows are NOT mutated here — claim/sell flow handles user
 *     credit at the API layer (mirrors v3 pm-AMM behaviour).
 *   - VOID refund: rather than touching balances directly, we set
 *     resolvedOutcome='INVALID' + state='VOID'. The /api/sell + /api/positions
 *     paths already treat INVALID as cost-basis refund (see tick/route.ts
 *     comment "INVALID counts as a winner (refund at cost basis on sell)").
 *
 * TODO Phase E refactor: tick/route.ts::resolveCase has very similar logic.
 * Once Phase E lands and adds a defensive `if (kind==='event_driven') continue;`
 * guard up there, we should extract a shared `markCaseResolved(tx, caseRow,
 * outcome, priceE8)` helper from both routes. Holding off until Phase E to
 * avoid merge conflicts on tick/route.ts.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { NextResponse } from "next/server";
import { and, eq, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { casesV3, positionsV3, seriesV3 } from "@/db/schema";
import {
  computeEcoOutcome,
  type EcoOutcome,
  type EventDrivenContext,
} from "@/lib/event-resolve";
import { fetchPythBatchPrices, type PythPriceTick } from "@/lib/pyth-hermes";
import {
  ECO_SERIES_BY_ID,
  type EcoSeriesConfig,
} from "@/lib/series-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SettleReport {
  nowSec: number;
  scanned: number;
  resolved: Array<{
    seriesId: string;
    roundIdx: number;
    outcome: string;
    voidReason?: string;
    winners: number;
    losers: number;
  }>;
  retried: Array<{ seriesId: string; roundIdx: number; reason: string }>;
  errors: Array<{ seriesId?: string; roundIdx?: number; error: string }>;
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const report: SettleReport = {
    nowSec,
    scanned: 0,
    resolved: [],
    retried: [],
    errors: [],
  };

  // Pull OPEN ECO cases whose release_time has passed.
  const due = await db
    .select({
      seriesId: casesV3.seriesId,
      roundIdx: casesV3.roundIdx,
      strikePriceE8: casesV3.strikePriceE8,
      releaseTimeSec: casesV3.releaseTimeSec,
      pythFeedId: seriesV3.pythFeedId,
      kind: seriesV3.kind,
    })
    .from(casesV3)
    .innerJoin(seriesV3, eq(seriesV3.seriesId, casesV3.seriesId))
    .where(
      and(
        eq(casesV3.state, "OPEN"),
        eq(seriesV3.kind, "event_driven"),
        lte(casesV3.releaseTimeSec, nowSec),
      ),
    );
  report.scanned = due.length;

  if (due.length === 0) return NextResponse.json(report);

  // Batch the Pyth fetch across distinct feed ids.
  const feedIds = Array.from(
    new Set(due.map((r) => r.pythFeedId.toLowerCase().replace(/^0x/, ""))),
  );
  let priceMap: Map<string, PythPriceTick> = new Map();
  try {
    priceMap = await fetchPythBatchPrices(feedIds);
  } catch (err) {
    report.errors.push({ error: `pyth batch: ${(err as Error).message}` });
    // Fall through — per-row tick will be missing → retry.
  }

  for (const row of due) {
    try {
      const seriesCfg = ECO_SERIES_BY_ID[row.seriesId];
      if (!seriesCfg) {
        report.errors.push({
          seriesId: row.seriesId,
          roundIdx: row.roundIdx,
          error: "ECO series config missing — DB row orphan?",
        });
        continue;
      }
      if (row.releaseTimeSec == null || row.strikePriceE8 == null) {
        report.errors.push({
          seriesId: row.seriesId,
          roundIdx: row.roundIdx,
          error: "case missing releaseTimeSec or strikePriceE8",
        });
        continue;
      }

      const tick = priceMap.get(
        row.pythFeedId.toLowerCase().replace(/^0x/, ""),
      );
      if (!tick) {
        report.retried.push({
          seriesId: row.seriesId,
          roundIdx: row.roundIdx,
          reason: "no Pyth tick available — retry next pass",
        });
        continue;
      }

      const ctx: EventDrivenContext = {
        releaseTimeSec: row.releaseTimeSec,
        settleMaxAgeSec: seriesCfg.eventDriven.settleMaxAgeSec,
        direction: seriesCfg.eventDriven.direction,
        strikePriceE8: row.strikePriceE8,
      };
      const decision: EcoOutcome = computeEcoOutcome(ctx, tick, nowSec);

      if (!decision.writeDb) {
        report.retried.push({
          seriesId: row.seriesId,
          roundIdx: row.roundIdx,
          reason: decision.voidReason ?? "computeEcoOutcome retry",
        });
        continue;
      }

      const counts = await resolveEcoCase(
        seriesCfg,
        row.roundIdx,
        decision,
        tick.priceE8,
      );
      report.resolved.push({
        seriesId: row.seriesId,
        roundIdx: row.roundIdx,
        outcome: decision.outcome,
        voidReason: decision.voidReason,
        winners: counts.winners,
        losers: counts.losers,
      });
    } catch (err) {
      report.errors.push({
        seriesId: row.seriesId,
        roundIdx: row.roundIdx,
        error: (err as Error).message,
      });
    }
  }

  return NextResponse.json(report);
}

// ───────────────────── helpers ─────────────────────

/**
 * Settle a single ECO case. Mirrors the rolling tick/route.ts::resolveCase
 * pattern — case state is locked but position rows remain untouched (the
 * /api/sell + claim flow handles user credit at the API layer).
 *
 * TODO Phase E: refactor shared settle helper from both routes once the
 * tick/route.ts event_driven guard is in place.
 */
async function resolveEcoCase(
  seriesCfg: EcoSeriesConfig,
  roundIdx: number,
  decision: EcoOutcome,
  actualReleasedPriceE8: bigint,
): Promise<{ winners: number; losers: number }> {
  let winners = 0;
  let losers = 0;
  await db.transaction(
    async (tx) => {
      const [caseRow] = await tx
        .select()
        .from(casesV3)
        .where(
          and(
            eq(casesV3.seriesId, seriesCfg.seriesId),
            eq(casesV3.roundIdx, roundIdx),
          ),
        )
        .limit(1);
      if (!caseRow || caseRow.state !== "OPEN") return; // raced; skip

      const positions = await tx
        .select({
          side: positionsV3.side,
          sharesE8: positionsV3.sharesE8,
        })
        .from(positionsV3)
        .where(
          and(
            eq(positionsV3.seriesId, seriesCfg.seriesId),
            eq(positionsV3.roundIdx, roundIdx),
          ),
        );
      for (const p of positions) {
        if (p.sharesE8 === 0n) continue;
        if (decision.outcome === "INVALID") {
          // VOID: every position is treated as cost-basis refund (handled in
          // /api/sell + /api/positions). Count as "winner" for reporting.
          winners++;
        } else if ((p.side as "UP" | "DOWN") === decision.outcome) {
          winners++;
        } else {
          losers++;
        }
      }

      const newState = decision.outcome === "INVALID" ? "VOID" : "RESOLVED";
      await tx
        .update(casesV3)
        .set({
          state: newState,
          resolvedPriceE8: actualReleasedPriceE8,
          resolvedOutcome: decision.outcome,
          actualReleasedPriceE8,
          voidReason: decision.voidReason ?? null,
          resolvedAt: new Date(),
        })
        .where(
          and(
            eq(casesV3.seriesId, seriesCfg.seriesId),
            eq(casesV3.roundIdx, roundIdx),
          ),
        );
    },
    { isolationLevel: "serializable" },
  );

  // Return counts (unused outside reporting).
  return { winners, losers };
}

// Suppress unused warnings on intentionally-unused `sql` import — kept for
// future SQL fragments (e.g. raw `coalesce(...)` arithmetic).
void sql;
