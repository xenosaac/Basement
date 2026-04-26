import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { casesV3, seriesV3 } from "@/db/schema";
import {
  computeCurrentRoundIdx,
  computeRoundClose,
  computeRoundStart,
  isMarketOpen,
  resolveSeriesFeedId,
  type SeriesStaticConfig,
} from "@/lib/series-config";
import { getCachedPrice, pythE8ToCents } from "@/lib/pyth-hermes";
import { curvePrices } from "@/lib/quant";
import { cachedView } from "@/lib/aptos-cache";
import { MARKET_GROUPS } from "@/lib/market-groups";
import type {
  SeriesCategory,
  SeriesListResponse,
  SeriesSummary,
} from "@/lib/types/v3-api";

/** Narrow seriesV3.strike_kind text → the locked union exposed in the API.
 *  NULL / unknown values fall back to "rise_fall" (legacy directional). */
type StrikeKind = "rise_fall" | "absolute_above" | "absolute_below";
function normalizeStrikeKind(raw: string | null | undefined): StrikeKind {
  if (raw === "absolute_above" || raw === "absolute_below") return raw;
  return "rise_fall";
}

export const dynamic = "force-dynamic";

/**
 * Adapter from a `series_v3` row to the `SeriesStaticConfig` shape that the
 * downstream helpers (computeRoundIdx, isMarketOpen, etc.) consume. Keeps
 * the helpers' implementation untouched while letting this endpoint be
 * driven by the DB instead of the static SERIES_CONFIG const.
 */
function rowToConfig(row: typeof seriesV3.$inferSelect): SeriesStaticConfig {
  return {
    seriesId: row.seriesId,
    assetSymbol: row.assetSymbol,
    pair: row.pair,
    category: row.category as SeriesCategory,
    cadenceSec: row.cadenceSec,
    // Snapshot kept for ECO/historical fallback; live consumers call
    // `resolveSeriesFeedId(s)` which prefers env via assetSymbol.
    pythFeedId: row.pythFeedId,
    seriesStartSec: row.seriesStartSec,
    marketHoursGated: row.marketHoursGated === 1,
    feeBps: row.feeBps,
    sortOrder: row.sortOrder,
  };
}

/**
 * Per-series payload exposed by `getActiveRollingSeries`. Carries the
 * SeriesStaticConfig (consumed by helpers) AND the v0.5 fields (strikeKind,
 * groupId) the GET handler needs to expose to clients without re-querying.
 */
interface ActiveSeries {
  config: SeriesStaticConfig;
  strikeKind: StrikeKind;
  groupId: string | null;
}

/**
 * Fetch every active rolling series from the DB. Cached 60s in-process
 * (Vercel Fluid Compute reuses lambda instances → high hit rate).
 * Invalidated on any seriesV3 insert by `ensureSeriesV3RowForGroup`.
 *
 * ECO (kind='event_driven') series live in their own cron path and
 * separate UI surface; this endpoint only returns rolling series.
 */
async function getActiveRollingSeries(): Promise<ActiveSeries[]> {
  return cachedView("series:all", 60_000, async () => {
    const rows = await db
      .select()
      .from(seriesV3)
      .where(eq(seriesV3.isActive, 1));
    return rows
      .filter((r) => r.kind == null || r.kind === "rolling")
      .map<ActiveSeries>((r) => ({
        config: rowToConfig(r),
        strikeKind: normalizeStrikeKind(r.strikeKind),
        groupId: r.groupId ?? null,
      }));
  });
}

export async function GET() {
  const nowSec = Math.floor(Date.now() / 1000);
  const active = await getActiveRollingSeries();

  const summaries: SeriesSummary[] = await Promise.all(
    active.map(async (entry): Promise<SeriesSummary> => {
      const s = entry.config;
      const { strikeKind, groupId } = entry;
      const currentRoundIdx = computeCurrentRoundIdx(s, nowSec);
      const startTimeSec = computeRoundStart(s, currentRoundIdx);
      const closeTimeSec = computeRoundClose(s, currentRoundIdx);
      const marketHours = isMarketOpen(s, nowSec);

      const feedId = resolveSeriesFeedId(s);
      const livePrice = await getCachedPrice(feedId).catch(() => null);
      const currentPriceCents = livePrice
        ? pythE8ToCents(livePrice.priceE8, livePrice.expo).toString()
        : null;

      // Lazy-spawn current round when market is open. Mirrors cron's spawn block
      // so dev environments without a tick scheduler still get round rows.
      // Closed-hours series (e.g. QQQ weekend) intentionally skip this.
      if (marketHours.open) {
        await db
          .insert(casesV3)
          .values({
            seriesId: s.seriesId,
            roundIdx: currentRoundIdx,
            startTimeSec,
            closeTimeSec,
            strikePriceE8: livePrice?.priceE8 ?? null,
            strikeCents: livePrice
              ? pythE8ToCents(livePrice.priceE8, livePrice.expo)
              : null,
            state: "OPEN",
          })
          .onConflictDoNothing();
      }

      const [caseRow] = await db
        .select({
          strikeCents: casesV3.strikeCents,
          strikePriceE8: casesV3.strikePriceE8,
          barrierLowPriceE8: casesV3.barrierLowPriceE8,
          barrierHighPriceE8: casesV3.barrierHighPriceE8,
          strikeKindCaptured: casesV3.strikeKindCaptured,
          upPoolCents: casesV3.upPoolCents,
          downPoolCents: casesV3.downPoolCents,
          upSharesE8: casesV3.upSharesE8,
          downSharesE8: casesV3.downSharesE8,
          resolvedOutcome: casesV3.resolvedOutcome,
        })
        .from(casesV3)
        .where(
          and(
            eq(casesV3.seriesId, s.seriesId),
            eq(casesV3.roundIdx, currentRoundIdx),
          ),
        )
        .limit(1);

      const prices = curvePrices(
        caseRow?.upSharesE8 ?? 0n,
        caseRow?.downSharesE8 ?? 0n,
      );

      // Pick the strike level that matches the series' strikeKind. We prefer
      // the per-case `strikeKindCaptured` snapshot when available so series
      // semantics changing mid-flight don't mis-render in-flight rounds.
      // - absolute_above → barrier_high (upper trigger)
      // - absolute_below → barrier_low  (lower trigger)
      // - rise_fall      → strike (== open price for directional rounds)
      const captured = normalizeStrikeKind(
        caseRow?.strikeKindCaptured ?? strikeKind,
      );
      let strikeRaw: bigint | null;
      if (captured === "absolute_above") {
        strikeRaw =
          caseRow?.barrierHighPriceE8 ?? caseRow?.strikePriceE8 ?? null;
      } else if (captured === "absolute_below") {
        strikeRaw =
          caseRow?.barrierLowPriceE8 ?? caseRow?.strikePriceE8 ?? null;
      } else {
        strikeRaw = caseRow?.strikePriceE8 ?? null;
      }

      // priceExpo: prefer the registry entry keyed by the series' groupId.
      // -8 fallback covers legacy crypto series (BTC/ETH 3m) that predate
      // the v0.5 registry mapping. -3/-5 are explicit on QQQ/NVDA/XAU rows.
      const priceExpo: number =
        (groupId ? MARKET_GROUPS[groupId]?.priceExpo : undefined) ?? -8;

      return {
        seriesId: s.seriesId,
        assetSymbol: s.assetSymbol,
        pair: s.pair,
        category: s.category,
        cadenceSec: s.cadenceSec,
        pythFeedId: feedId,
        marketHoursGated: s.marketHoursGated,
        sortOrder: s.sortOrder,
        currentRoundIdx,
        currentStartTimeSec: startTimeSec,
        currentCloseTimeSec: closeTimeSec,
        currentStrikeCents: caseRow?.strikeCents?.toString() ?? null,
        currentUpPoolCents: (caseRow?.upPoolCents ?? 0n).toString(),
        currentDownPoolCents: (caseRow?.downPoolCents ?? 0n).toString(),
        currentUpPriceCents: prices.upCents,
        currentDownPriceCents: prices.downCents,
        currentPriceCents,
        currentResolvedOutcome: caseRow?.resolvedOutcome ?? null,
        marketHours,
        strikeKind,
        strikePriceE8: strikeRaw === null ? null : strikeRaw.toString(),
        priceExpo,
      };
    }),
  );

  const response: SeriesListResponse = {
    series: summaries.sort((a, b) => a.sortOrder - b.sortOrder),
  };
  return NextResponse.json(response);
}
