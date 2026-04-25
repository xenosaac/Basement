import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { casesV3, seriesV3 } from "@/db/schema";
import {
  computeCurrentRoundIdx,
  computeRoundClose,
  computeRoundStart,
  isMarketOpen,
  type SeriesStaticConfig,
} from "@/lib/series-config";
import { getCachedPrice, pythE8ToCents } from "@/lib/pyth-hermes";
import { curvePrices } from "@/lib/quant";
import { cachedView } from "@/lib/aptos-cache";
import type {
  SeriesCategory,
  SeriesListResponse,
  SeriesSummary,
} from "@/lib/types/v3-api";

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
    pythFeedId: row.pythFeedId,
    seriesStartSec: row.seriesStartSec,
    marketHoursGated: row.marketHoursGated === 1,
    feeBps: row.feeBps,
    sortOrder: row.sortOrder,
  };
}

/**
 * Fetch every active rolling series from the DB. Cached 60s in-process
 * (Vercel Fluid Compute reuses lambda instances → high hit rate).
 * Invalidated on any seriesV3 insert by `ensureSeriesV3RowForGroup`.
 *
 * ECO (kind='event_driven') series live in their own cron path and
 * separate UI surface; this endpoint only returns rolling series.
 */
async function getActiveRollingSeries(): Promise<SeriesStaticConfig[]> {
  return cachedView("series:all", 60_000, async () => {
    const rows = await db
      .select()
      .from(seriesV3)
      .where(eq(seriesV3.isActive, 1));
    return rows
      .filter((r) => r.kind == null || r.kind === "rolling")
      .map(rowToConfig);
  });
}

export async function GET() {
  const nowSec = Math.floor(Date.now() / 1000);
  const configs = await getActiveRollingSeries();

  const summaries: SeriesSummary[] = await Promise.all(
    configs.map(async (s): Promise<SeriesSummary> => {
      const currentRoundIdx = computeCurrentRoundIdx(s, nowSec);
      const startTimeSec = computeRoundStart(s, currentRoundIdx);
      const closeTimeSec = computeRoundClose(s, currentRoundIdx);
      const marketHours = isMarketOpen(s, nowSec);

      const livePrice = await getCachedPrice(s.pythFeedId).catch(() => null);
      const currentPriceCents = livePrice
        ? pythE8ToCents(livePrice.priceE8, livePrice.expo).toString()
        : null;

      // Lazy-spawn current round when market is open. Mirrors cron's spawn block
      // so dev environments without a tick scheduler still get round rows.
      // Closed-hours series (e.g. US500 weekend) intentionally skip this.
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

      return {
        seriesId: s.seriesId,
        assetSymbol: s.assetSymbol,
        pair: s.pair,
        category: s.category,
        cadenceSec: s.cadenceSec,
        pythFeedId: s.pythFeedId,
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
      };
    }),
  );

  const response: SeriesListResponse = {
    series: summaries.sort((a, b) => a.sortOrder - b.sortOrder),
  };
  return NextResponse.json(response);
}
