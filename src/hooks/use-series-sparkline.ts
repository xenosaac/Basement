"use client";

/**
 * Basement v3 sparkline hook — batched `/api/series/ticks` fetcher plus a thin
 * per-series selector so every card on the /markets grid shares a single
 * network request.
 *
 * Refetch cadence is 8s with up to 1.5s jitter (per MASTER §2 D21) to decorrelate
 * from `useSeriesV3`'s 4s poll and avoid thundering-herd phase alignment.
 *
 * Wire format: `SeriesTicksResponse.ticks[seriesId][].priceCents` is a
 * stringified bigint. We normalize to `SparklineTick.priceCents: bigint` once
 * at the query boundary so downstream consumers stay bigint-safe.
 */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type {
  SeriesId,
  SeriesTicksResponse,
} from "@/lib/types/v3-api";

// ───────────────────── Types ─────────────────────

export interface SparklineTick {
  tSec: number;
  priceCents: bigint;
}

export interface UseSeriesSparklineResult {
  ticks: SparklineTick[];
  isLoading: boolean;
  isError: boolean;
}

export interface UseAllSeriesSparklinesResult {
  data: Partial<Record<SeriesId, SparklineTick[]>>;
  isLoading: boolean;
  isError: boolean;
}

// ───────────────────── Internals ─────────────────────

const DEFAULT_WINDOW_SEC = 1800;

function parsePriceCents(raw: string): bigint {
  // Defensive: if the API ever emits a float-looking string ("123.45"),
  // BigInt() throws. Fall back to integer part.
  try {
    return BigInt(raw);
  } catch {
    const cleaned = raw.replace(/\..*$/, "");
    try {
      return BigInt(cleaned);
    } catch {
      return 0n;
    }
  }
}

function normalizeResponse(
  res: SeriesTicksResponse,
): Partial<Record<SeriesId, SparklineTick[]>> {
  const out: Partial<Record<SeriesId, SparklineTick[]>> = {};
  for (const [seriesId, arr] of Object.entries(res.ticks)) {
    if (!arr) continue;
    out[seriesId as SeriesId] = arr.map((t) => ({
      tSec: t.tSec,
      priceCents: parsePriceCents(t.priceCents),
    }));
  }
  return out;
}

async function fetchSparklines(
  windowSec: number,
): Promise<Partial<Record<SeriesId, SparklineTick[]>>> {
  const url = `/api/series/ticks?windowSec=${windowSec}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch series ticks: ${res.status}`);
  }
  const body = (await res.json()) as SeriesTicksResponse;
  return normalizeResponse(body);
}

// ───────────────────── Public hooks ─────────────────────

/**
 * Batched query owner — fetches ticks for all series in a single request.
 * Every card on /markets should consume this via `useSeriesSparkline` rather
 * than calling `useAllSeriesSparklines` independently (same queryKey dedupes
 * at the React Query layer, but the selector keeps consumer code simple).
 */
export function useAllSeriesSparklines(
  windowSec?: number,
): UseAllSeriesSparklinesResult {
  const w = windowSec ?? DEFAULT_WINDOW_SEC;

  // D21 jitter: generate once per hook lifetime, not per render. 8000..9500ms.
  const [refetchInterval] = useState<number>(
    () => 8_000 + Math.floor(Math.random() * 1500),
  );

  const query = useQuery<Partial<Record<SeriesId, SparklineTick[]>>>({
    queryKey: ["series-ticks", w],
    queryFn: () => fetchSparklines(w),
    staleTime: 6_000,
    refetchInterval,
    refetchOnWindowFocus: true,
  });

  return {
    data: query.data ?? {},
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/**
 * Thin selector on top of `useAllSeriesSparklines`. Multiple cards calling this
 * with the same `windowSec` share the underlying React Query cache entry — one
 * network request feeds all.
 */
export function useSeriesSparkline(
  seriesId: SeriesId,
  windowSec?: number,
): UseSeriesSparklineResult {
  const { data, isLoading, isError } = useAllSeriesSparklines(windowSec);
  return {
    ticks: data[seriesId] ?? [],
    isLoading,
    isError,
  };
}
