import { NextResponse } from "next/server";
import { and, gt, inArray, asc } from "drizzle-orm";
import { db } from "@/db";
import { priceTicksV3 } from "@/db/schema";
import { SERIES_CONFIG } from "@/lib/series-config";
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

  const allowedIds = new Set<SeriesId>(SERIES_CONFIG.map((s) => s.seriesId));
  const ids: SeriesId[] = idsParam
    ? idsParam
        .split(",")
        .map((s) => s.trim() as SeriesId)
        .filter((s) => allowedIds.has(s))
    : SERIES_CONFIG.map((s) => s.seriesId);

  if (ids.length === 0) {
    const empty: SeriesTicksResponse = { windowSec, ticks: {} };
    return NextResponse.json(empty);
  }

  const feedIdToSeriesId = new Map<string, SeriesId>();
  for (const s of SERIES_CONFIG) {
    if (ids.includes(s.seriesId)) {
      feedIdToSeriesId.set(s.pythFeedId, s.seriesId);
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
    const seriesId = feedIdToSeriesId.get(row.pythFeedId);
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
