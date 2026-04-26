import { NextResponse } from "next/server";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  casesV3,
  positionsV3,
  priceTicksV3,
  seriesV3,
} from "@/db/schema";
import {
  computeCurrentRoundIdx,
  computeRoundClose,
  computeRoundStart,
  isMarketOpen,
  resolveSeriesFeedId,
  type SeriesStaticConfig,
} from "@/lib/series-config";
import { cachedView } from "@/lib/aptos-cache";
import {
  fetchPythBatchPrices,
  fetchPythBatchPricesResilient,
  lookupTick,
  pythE8ToCents,
} from "@/lib/pyth-hermes";
import { computeOutcome } from "@/lib/parimutuel";
import { computeBarrierOutcome } from "@/lib/barrier-resolve";
import type { SeriesCategory } from "@/lib/types/v3-api";

export const dynamic = "force-dynamic";

/**
 * Single cron endpoint. Called every 30s by GitHub Actions (or similar external
 * trigger). Does three things atomically per invocation:
 *
 * 1. Refresh Pyth prices for all active rolling series (single Hermes batch)
 * 2. Rotate rounds: for each series, ensure current round exists; close any
 *    expired OPEN rounds; resolve by outcome + settle payouts
 * 3. Record price_ticks for audit
 *
 * **Source of truth (post 2026-04-24):**
 *   - The series rotation list is read from `series_v3` (DB) — same loader
 *     contract as `/api/series`. No more SERIES_CONFIG iteration.
 *   - Pyth feed IDs are resolved per-series via `resolveSeriesFeedId(s)` →
 *     `pythFeedIdForSymbol(assetSymbol)` → live `.env` value. Rotating an
 *     env id picks up on the next tick without a deploy.
 *
 * v0.5 (Phase E) settle path handles three `strikeKindCaptured` values:
 *   - 'absolute_above' / 'absolute_below' / null  → legacy `computeOutcome`
 *   - 'barrier_two_sided'                         → `computeBarrierOutcome`
 * Series with `kind === 'event_driven'` (ECO) are settled by `cron/eco-settle`
 * and filtered out by `getActiveRollingSeriesForTick()` below.
 *
 * Auth: Bearer ${CRON_SECRET}
 * Idempotent: safe to call concurrently (SERIALIZABLE tx on settle)
 */

/**
 * Active rolling series for the tick rotation loop. DB-driven, cached 60s
 * in-process (matches /api/series contract). Each row is mapped through
 * `rowToConfig` so `seriesV3.$inferSelect` shape never leaks downstream;
 * downstream helpers continue to take `SeriesStaticConfig`.
 *
 * Filters: `is_active = 1` AND `kind` is null OR 'rolling'. ECO/event_driven
 * goes through `cron/eco-settle`.
 */
async function getActiveRollingSeriesForTick(): Promise<SeriesStaticConfig[]> {
  return cachedView("series:rolling-tick", 60_000, async () => {
    const rows = await db
      .select()
      .from(seriesV3)
      .where(eq(seriesV3.isActive, 1));
    return rows
      .filter((r) => r.kind == null || r.kind === "rolling")
      .map(
        (r): SeriesStaticConfig => ({
          seriesId: r.seriesId,
          assetSymbol: r.assetSymbol,
          pair: r.pair,
          category: r.category as SeriesCategory,
          cadenceSec: r.cadenceSec,
          // Snapshot kept as fallback only — `resolveSeriesFeedId` prefers env.
          pythFeedId: r.pythFeedId,
          marketHoursGated: r.marketHoursGated === 1,
          feeBps: r.feeBps,
          sortOrder: r.sortOrder,
          seriesStartSec: r.seriesStartSec,
        }),
      );
  });
}

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

  const seriesList = await getActiveRollingSeriesForTick();

  // 1. Refresh Pyth prices for all active feeds in one batch. Resolve via env;
  // de-dupe (multiple series can share an asset symbol, e.g. BTC daily strike
  // siblings).
  const feedIdSet = new Set<string>();
  for (const s of seriesList) {
    try {
      feedIdSet.add(resolveSeriesFeedId(s));
    } catch (err) {
      report.errors.push({
        seriesId: s.seriesId,
        error: `feed-id resolve: ${(err as Error).message}`,
      });
    }
  }
  const allFeedIds = Array.from(feedIdSet);
  let priceMap: Awaited<ReturnType<typeof fetchPythBatchPrices>> = new Map();
  try {
    // Hermes-beta drops feeds from `parsed[]` ~20% of the time when batching
    // mixed crypto + TradFi (CLAUDE.md Pyth 抓取纪律 §3). Resilient wrapper
    // re-fetches only the missing feeds so price_ticks_v3 / spawn / resolve
    // all see a complete priceMap from one call site.
    priceMap = await fetchPythBatchPricesResilient(allFeedIds);
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
  for (const series of seriesList) {
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
  const liveTick = lookupTick(priceMap, resolveSeriesFeedId(series));

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

  // Spawn current round if not present AND market open (skip RTH-gated series off-hours)
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
    // Hermes-beta 在 batch 拉多 feed + Vercel 多 cron 并发时约 20% 概率漏返
    // 某个 feed（partial JSON, 不 throw）。缺 strike 不能 spawn — 不然这个
    // round 必死 VOID（resolve 时 strike==close → INVALID）。先做一次单
    // feed inline retry 抢救；还是没有就 skip 这个 tick，下个 cron tick 重试。
    let strikeTick = liveTick;
    if (!strikeTick) {
      try {
        const feedId = resolveSeriesFeedId(series);
        const retry = await fetchPythBatchPrices([feedId]);
        strikeTick = lookupTick(retry, feedId);
      } catch (err) {
        report.errors.push({
          seriesId: series.seriesId,
          error: `pyth strike retry failed: ${(err as Error).message}`,
        });
      }
    }
    if (!strikeTick) {
      report.errors.push({
        seriesId: series.seriesId,
        error: `skip spawn ${currentIdx} — no Pyth strike (will retry next tick)`,
      });
      return;
    }
    const startSec = computeRoundStart(series, currentIdx);
    const closeSec = computeRoundClose(series, currentIdx);
    await db
      .insert(casesV3)
      .values({
        seriesId: series.seriesId,
        roundIdx: currentIdx,
        startTimeSec: startSec,
        closeTimeSec: closeSec,
        strikePriceE8: strikeTick.priceE8,
        strikeCents: pythE8ToCents(strikeTick.priceE8, strikeTick.expo),
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
  const feedId = resolveSeriesFeedId(series);
  const liveTick = lookupTick(priceMap, feedId);
  if (!liveTick) {
    report.errors.push({
      seriesId: series.seriesId,
      error: `no Pyth tick for ${feedId}, skipping resolve`,
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
        if (caseRow.strikePriceE8 === null) {
          // spawn 路径已堵 NULL strike（rotateSeriesRounds skip-on-miss）。
          // 万一残留 NULL，绝不静默 fallback 成 strike==close → 必然 INVALID
          // —— 那会掩盖 spawn-时 Pyth 抓取失败的真相。留 OPEN 让 operator
          // 看到 errors 报告手动决定（强制 VOID / 手填 strike / 重 spawn）。
          report.errors.push({
            seriesId: series.seriesId,
            error: `cannot resolve ${roundIdx} — strikePriceE8 NULL (spawn-time pyth fail, left OPEN)`,
          });
          return;
        }
        outcome = computeOutcome(caseRow.strikePriceE8, closeE8);
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

      // Mark case RESOLVED / VOID. Balance untouched (sell-to-redeem).
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

      // Record losses for losing positions. Without this write, a loss never
      // enters realized_pnl_cents — the user has no reason to sell shares
      // that are worth $0, so the loss would silently be excluded from
      // Lifetime PnL / Leaderboard PnL aggregations forever. Winning side is
      // intentionally left untouched: the redemption PnL is booked at sell
      // time by /api/sell (sell-to-redeem invariant). VOID skips this — the
      // user can still sell at cost-basis refund.
      if (outcome === "UP" || outcome === "DOWN") {
        const losingSide = outcome === "UP" ? "DOWN" : "UP";
        await tx
          .update(positionsV3)
          .set({
            realizedPnlCents: sql`${positionsV3.realizedPnlCents} - ${positionsV3.costBasisCents}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(positionsV3.seriesId, series.seriesId),
              eq(positionsV3.roundIdx, roundIdx),
              eq(positionsV3.side, losingSide),
              gt(positionsV3.sharesE8, 0n),
            ),
          );
      }

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
