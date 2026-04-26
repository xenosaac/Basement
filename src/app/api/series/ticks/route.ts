import { NextResponse } from "next/server";
import { and, gt, inArray, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { priceTicksV3, seriesV3 } from "@/db/schema";
import { resolveSeriesFeedId } from "@/lib/series-config";
import { cachedView } from "@/lib/aptos-cache";
import { pythE8ToCents } from "@/lib/pyth-hermes";
import type {
  SeriesId,
  SeriesTick,
  SeriesTicksResponse,
} from "@/lib/types/v3-api";

export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_SEC = 1800;
const MIN_WINDOW_SEC = 60;
const MAX_WINDOW_SEC = 14_400;
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 120;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids");
  const windowParam = url.searchParams.get("windowSec");
  const limitParam = url.searchParams.get("limit");

  const windowSec = clamp(
    windowParam ? Math.floor(Number(windowParam)) : DEFAULT_WINDOW_SEC,
    MIN_WINDOW_SEC,
    MAX_WINDOW_SEC,
  );
  const limit = clamp(
    limitParam ? Math.floor(Number(limitParam)) : DEFAULT_LIMIT,
    1,
    MAX_LIMIT,
  );

  // DB-driven series list (matches /api/series). Cached 60s in-process.
  const activeRows = await cachedView(
    "series:ticks-allowed",
    60_000,
    async () =>
      db
        .select({
          seriesId: seriesV3.seriesId,
          assetSymbol: seriesV3.assetSymbol,
          pythFeedId: seriesV3.pythFeedId,
        })
        .from(seriesV3)
        .where(eq(seriesV3.isActive, 1)),
  );

  const allowedIds = new Set<SeriesId>(activeRows.map((r) => r.seriesId));
  const ids: SeriesId[] = idsParam
    ? idsParam
        .split(",")
        .map((s) => s.trim() as SeriesId)
        .filter((s) => allowedIds.has(s))
    : activeRows.map((r) => r.seriesId);

  if (ids.length === 0) {
    const empty: SeriesTicksResponse = { windowSec, ticks: {} };
    return NextResponse.json(empty);
  }

  // Resolve each series' live feed id via env (rolling) or DB snapshot
  // (ECO/historical). Pyth Hermes returns ids unprefixed and lower-case
  // and the cron tick stores them as-fetched, so the env value (which
  // typically carries the 0x prefix) must be normalized to no-0x lowercase
  // here AND when matching rows below — otherwise inArray returns 0 rows
  // and the sparkline stays empty even when ticks are flowing.
  const normalizeFeedId = (id: string) =>
    id.toLowerCase().replace(/^0x/, "");
  const feedIdToSeriesId = new Map<string, SeriesId>();
  for (const r of activeRows) {
    if (!ids.includes(r.seriesId)) continue;
    try {
      feedIdToSeriesId.set(normalizeFeedId(resolveSeriesFeedId(r)), r.seriesId);
    } catch {
      // Skip rows whose feed id cannot resolve — leaves their bucket empty
      // in the response rather than 500ing the entire ticks endpoint.
      continue;
    }
  }
  const feedIds = Array.from(feedIdToSeriesId.keys());

  const sinceSec = Math.floor(Date.now() / 1000) - windowSec;

  const rows = await db
    .select({
      pythFeedId: priceTicksV3.pythFeedId,
      priceE8: priceTicksV3.priceE8,
      publishTimeSec: priceTicksV3.publishTimeSec,
    })
    .from(priceTicksV3)
    .where(
      and(
        inArray(priceTicksV3.pythFeedId, feedIds),
        gt(priceTicksV3.publishTimeSec, sinceSec),
      ),
    )
    .orderBy(asc(priceTicksV3.publishTimeSec));

  // rows are ASC by publishTimeSec; group then trim to last `limit` per series
  // (most recent N points — Polymarket-style sparkline shows recent history).
  const fullBySeries: Partial<Record<SeriesId, SeriesTick[]>> = {};
  for (const row of rows) {
    const seriesId = feedIdToSeriesId.get(normalizeFeedId(row.pythFeedId));
    if (!seriesId) continue;
    const arr = fullBySeries[seriesId] ?? (fullBySeries[seriesId] = []);
    arr.push({
      tSec: row.publishTimeSec,
      priceCents: pythE8ToCents(row.priceE8, -8).toString(),
    });
  }
  const ticksBySeries: Partial<Record<SeriesId, SeriesTick[]>> = {};
  for (const [seriesId, arr] of Object.entries(fullBySeries)) {
    if (!arr) continue;
    ticksBySeries[seriesId as SeriesId] =
      arr.length > limit ? arr.slice(arr.length - limit) : arr;
  }

  const body: SeriesTicksResponse = { windowSec, ticks: ticksBySeries };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
    },
  });
}
