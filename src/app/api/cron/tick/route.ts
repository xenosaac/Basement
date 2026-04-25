import { NextResponse } from "next/server";
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  casesV3,
  positionsV3,
  priceTicksV3,
} from "@/db/schema";
import {
  SERIES_CONFIG,
  computeCurrentRoundIdx,
  computeRoundClose,
  computeRoundStart,
  isMarketOpen,
  type SeriesStaticConfig,
} from "@/lib/series-config";
import { fetchPythBatchPrices, pythE8ToCents } from "@/lib/pyth-hermes";
import { computeOutcome } from "@/lib/parimutuel";
import { computeBarrierOutcome } from "@/lib/barrier-resolve";

export const dynamic = "force-dynamic";

/**
 * Single cron endpoint. Called every 30s by GitHub Actions (or similar external
 * trigger). Does three things atomically per invocation:
 *
 * 1. Refresh Pyth prices for all 7 series (single Hermes batch call)
 * 2. Rotate rounds: for each series, ensure current round exists; close any
 *    expired OPEN rounds; resolve by outcome + settle payouts
 * 3. Record price_ticks for audit
 *
 * v0.5 (Phase E) settle path handles three `strikeKindCaptured` values:
 *   - 'absolute_above' / 'absolute_below' / null  → legacy `computeOutcome`
 *     (close vs strike threshold, INVALID on tie)
 *   - 'barrier_two_sided'                         → `computeBarrierOutcome`
 *     (UP iff price breached either barrier, DOWN if it stayed inside)
 * Series with `kind === 'event_driven'` (ECO / Phase G) are routed to the
 * dedicated `cron/eco-settle` cron and explicitly skipped here as a defensive
 * guard, in case an event_driven series ever leaks into SERIES_CONFIG.
 *
 * Auth: Bearer ${CRON_SECRET}
 * Idempotent: safe to call concurrently (SERIALIZABLE tx on settle)
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const report = {
    nowSec,
    priceRefreshed: 0,
    roundsSpawned: [] as string[],
    roundsResolved: [] as Array<{
      seriesId: string;
      roundIdx: number;
      outcome: string;
      winners: number;
      losers: number;
      platformFeeCents: string;
    }>,
    errors: [] as Array<{ seriesId?: string; error: string }>,
  };

  // 1. Refresh Pyth prices for all 7 feeds in one batch
  const allFeedIds = SERIES_CONFIG.map((s) => s.pythFeedId);
  let priceMap: Awaited<ReturnType<typeof fetchPythBatchPrices>> = new Map();
  try {
    priceMap = await fetchPythBatchPrices(allFeedIds);
    report.priceRefreshed = priceMap.size;

    // Record price_ticks for audit (best-effort)
    const tickRows = Array.from(priceMap.values()).map((t) => ({
      pythFeedId: t.feedId,
      priceE8: t.priceE8,
      publishTimeSec: t.publishTimeSec,
    }));
    if (tickRows.length > 0) {
      await db.insert(priceTicksV3).values(tickRows).onConflictDoNothing();
    }
  } catch (err) {
    report.errors.push({ error: `pyth fetch: ${(err as Error).message}` });
  }

  // 2. Per-series rotation
  for (const series of SERIES_CONFIG) {
    try {
      await rotateSeriesRounds(series, nowSec, priceMap, report);
    } catch (err) {
      report.errors.push({
        seriesId: series.seriesId,
        error: (err as Error).message,
      });
    }
  }

  return NextResponse.json(report);
}

async function rotateSeriesRounds(
  series: SeriesStaticConfig,
  nowSec: number,
  priceMap: Awaited<ReturnType<typeof fetchPythBatchPrices>>,
  report: {
    roundsSpawned: string[];
    roundsResolved: Array<{
      seriesId: string;
      roundIdx: number;
      outcome: string;
      winners: number;
      losers: number;
      platformFeeCents: string;
    }>;
    errors: Array<{ seriesId?: string; error: string }>;
  },
) {
  // Defense-in-depth: ECO (event_driven) series live in `ECO_SERIES_CONFIG`,
  // not the rolling `SERIES_CONFIG` iterated here, and are settled by the
  // dedicated `cron/eco-settle` cron. If one ever leaks into the rolling
  // registry, this guard prevents the rotation loop from spawning rolling
  // rounds or running rolling settle against the ECO case. See series-config.ts.
  if (series.kind === "event_driven") return;

  const currentIdx = computeCurrentRoundIdx(series, nowSec);
  const liveTick = priceMap.get(series.pythFeedId.toLowerCase());

  // Close + resolve any OPEN rounds past their close_time (could be prior cycles)
  const expired = await db
    .select()
    .from(casesV3)
    .where(
      and(
        eq(casesV3.seriesId, series.seriesId),
        eq(casesV3.state, "OPEN"),
        lte(casesV3.closeTimeSec, BigInt(nowSec) as unknown as number),
      ),
    );

  for (const c of expired) {
    await resolveCase(series, c.roundIdx as number, priceMap, report);
  }

  // Spawn current round if not present AND market open (skip US500 off-hours)
  const hours = isMarketOpen(series, nowSec);
  if (!hours.open) return;

  const existing = await db
    .select({ roundIdx: casesV3.roundIdx })
    .from(casesV3)
    .where(
      and(
        eq(casesV3.seriesId, series.seriesId),
        eq(casesV3.roundIdx, currentIdx),
      ),
    )
    .limit(1);
  if (existing.length === 0) {
    const startSec = computeRoundStart(series, currentIdx);
    const closeSec = computeRoundClose(series, currentIdx);
    const strikeE8 = liveTick?.priceE8 ?? null;
    const strikeCents = liveTick
      ? pythE8ToCents(liveTick.priceE8, liveTick.expo)
      : null;
    await db
      .insert(casesV3)
      .values({
        seriesId: series.seriesId,
        roundIdx: currentIdx,
        startTimeSec: startSec,
        closeTimeSec: closeSec,
        strikePriceE8: strikeE8,
        strikeCents,
        state: "OPEN",
      })
      .onConflictDoNothing();
    report.roundsSpawned.push(`${series.seriesId}#${currentIdx}`);
  }
}

async function resolveCase(
  series: SeriesStaticConfig,
  roundIdx: number,
  priceMap: Awaited<ReturnType<typeof fetchPythBatchPrices>>,
  report: {
    roundsResolved: Array<{
      seriesId: string;
      roundIdx: number;
      outcome: string;
      winners: number;
      losers: number;
      platformFeeCents: string;
    }>;
    errors: Array<{ seriesId?: string; error: string }>;
  },
) {
  // Use latest Pyth price (close-time price is best-effort; demo uses most
  // recent available — production would select tick closest to close_time).
  const liveTick = priceMap.get(series.pythFeedId.toLowerCase());
  if (!liveTick) {
    report.errors.push({
      seriesId: series.seriesId,
      error: `no Pyth tick for ${series.pythFeedId}, skipping resolve`,
    });
    return;
  }

  // pm-AMM share-based settlement:
  //   winning side: each share → $1.00 (PAYOUT_CENTS_PER_SHARE)
  //   losing side : 0
  //   INVALID     : refund position cost basis
  //   Buy orders' payoutCents are written as a per-order pro-rata of the
  //   user's total position payout (display only — money flow is via the
  //   position credit). Sell orders already have payoutCents = sell proceeds.
  await db.transaction(
    async (tx) => {
      const [caseRow] = await tx
        .select()
        .from(casesV3)
        .where(
          and(
            eq(casesV3.seriesId, series.seriesId),
            eq(casesV3.roundIdx, roundIdx),
          ),
        )
        .limit(1);
      if (!caseRow || caseRow.state !== "OPEN") return;

      const closeE8 = liveTick.priceE8;
      // strikeKindCaptured is the spawn-time snapshot of seriesV3.strikeKind
      // (more reliable than re-reading series.strikeKind, which may be edited
      // mid-round). Legacy rolling rows captured before Phase A are NULL and
      // default to absolute_above semantics via parimutuel.computeOutcome.
      const kind = caseRow.strikeKindCaptured ?? "absolute_above";

      let outcome: "UP" | "DOWN" | "INVALID";
      if (kind === "barrier_two_sided") {
        if (
          caseRow.barrierLowPriceE8 == null ||
          caseRow.barrierHighPriceE8 == null
        ) {
          throw new Error(
            `barrier case ${series.seriesId}#${roundIdx} missing barrier columns ` +
              `(low=${caseRow.barrierLowPriceE8}, high=${caseRow.barrierHighPriceE8})`,
          );
        }
        outcome = computeBarrierOutcome(
          closeE8,
          caseRow.barrierLowPriceE8,
          caseRow.barrierHighPriceE8,
        );
      } else {
        // 'absolute_above' | 'absolute_below' | legacy null. The threshold
        // direction is encoded by the series spec; v0 settle (DB-side) uses
        // strict close-vs-strike for both — chain `threshold_type` is the
        // spawn placeholder and not consulted here. computeOutcome returns
        // UP/DOWN/INVALID based on close vs strike, and INVALID is treated
        // as a refund downstream.
        const strikeE8 = caseRow.strikePriceE8 ?? closeE8;
        outcome = computeOutcome(strikeE8, closeE8);
      }

      // pm-AMM order-book model: at resolve we only LOCK the outcome.
      // Positions stay as-is (sharesE8 untouched). Users sell their shares
      // post-resolve via /api/sell at fixed price (winning side = $1.00,
      // losing = $0.00). Realized P&L only accrues from actual sells.

      const positions = await tx
        .select({
          userAddress: positionsV3.userAddress,
          side: positionsV3.side,
          sharesE8: positionsV3.sharesE8,
        })
        .from(positionsV3)
        .where(
          and(
            eq(positionsV3.seriesId, series.seriesId),
            eq(positionsV3.roundIdx, roundIdx),
          ),
        );

      let winnerCount = 0;
      let loserCount = 0;
      for (const p of positions) {
        if (p.sharesE8 === 0n) continue;
        if (outcome === "INVALID") {
          // INVALID counts as a winner (refund at cost basis on sell)
          winnerCount++;
        } else if ((p.side as "UP" | "DOWN") === outcome) {
          winnerCount++;
        } else {
          loserCount++;
        }
      }

      // Mark case RESOLVED / VOID. That's it — no balance, no PnL writes.
      await tx
        .update(casesV3)
        .set({
          state: outcome === "INVALID" ? "VOID" : "RESOLVED",
          resolvedPriceE8: closeE8,
          resolvedOutcome: outcome,
          resolvedAt: new Date(),
        })
        .where(
          and(
            eq(casesV3.seriesId, series.seriesId),
            eq(casesV3.roundIdx, roundIdx),
          ),
        );

      report.roundsResolved.push({
        seriesId: series.seriesId,
        roundIdx,
        outcome,
        winners: winnerCount,
        losers: loserCount,
        platformFeeCents: "0",
      });
    },
    { isolationLevel: "serializable" },
  );
}
