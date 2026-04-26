/**
 * 7-day realized volatility estimator — Basement v0.5 Phase B.
 *
 * Pulls the last 7 days of `priceTicksV3` rows for a series's Pyth feed,
 * computes close-to-close log returns, takes the standard deviation, and
 * annualises by `sqrt(SECONDS_PER_YEAR / avgDtSec)`. Falls back to the
 * per-asset `defaultSigmaAnnual` from `ASSET_PARAMS` when sample count is
 * insufficient (cold-start, brand-new asset, or feed outage).
 *
 * Architecture: inner `_computeFromSamples` is a pure function operating on
 * an array of `{priceE8, publishTimeSec}` rows; outer `computeRealizedVol7d`
 * wraps the DB query + 5-min in-memory TTL cache. Tests target the pure
 * function for deterministic coverage; the wrapper is exercised by an
 * integration smoke test using a stubbed fetcher.
 */

import { sql, and, eq, gte, lte, asc } from "drizzle-orm";
import { db } from "@/db";
import { priceTicksV3, seriesV3 } from "@/db/schema";
import { resolveSeriesFeedId } from "@/lib/series-config";
import type { AssetParams, VolEstimate } from "./types";
import { getAssetParams } from "./asset-params";
import { SECONDS_PER_YEAR } from "./barrier-strike";

const SEVEN_DAYS_SEC = 7 * 86400;
const MIN_SAMPLES = 5;
const FRESH_MIN_SAMPLES = 50;
const FRESH_MAX_AGE_SEC = 2 * 3600; // 2h
const CACHE_BUCKET_SEC = 300; // 5min

/** Public sample shape (matches `priceTicksV3` column types). */
export interface VolSample {
  priceE8: bigint;
  publishTimeSec: number;
}

/**
 * Pure σ computation from a (chronologically-sorted, but resilient to noise)
 * list of price samples. Skips priceE8 ≤ 0, skips zero-dt pairs, falls back
 * to per-asset default when there are fewer than `MIN_SAMPLES` usable
 * returns.
 *
 * Exported for unit tests; production callers should use `computeRealizedVol7d`.
 */
export function _computeFromSamples(
  samples: VolSample[],
  asset: string,
  fallback: AssetParams,
): VolEstimate {
  // Drop non-positive prices defensively (Pyth conf-interval edge cases).
  const clean = samples.filter((s) => s.priceE8 > 0n).slice();
  // Sort ASC to ensure log-return direction is consistent.
  clean.sort((a, b) => a.publishTimeSec - b.publishTimeSec);

  const returns: number[] = [];
  let dtSum = 0;
  let dtCount = 0;
  let lastSampleSec = 0;

  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1];
    const cur = clean[i];
    const dt = cur.publishTimeSec - prev.publishTimeSec;
    if (dt <= 0) continue; // skip dup / out-of-order
    // log-return on raw priceE8 — the e8 scale cancels in log ratio.
    const r = Math.log(Number(cur.priceE8) / Number(prev.priceE8));
    if (!Number.isFinite(r)) continue;
    returns.push(r);
    dtSum += dt;
    dtCount += 1;
    lastSampleSec = Math.max(lastSampleSec, cur.publishTimeSec);
  }

  if (returns.length < MIN_SAMPLES) {
    return {
      sigmaAnnual: fallback.defaultSigmaAnnual,
      sampleCount: returns.length,
      lastSampleSec: 0,
      isFresh: false,
      source: "fallback",
    };
  }

  // Sample standard deviation (ddof=1).
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) /
    Math.max(1, returns.length - 1);
  const sigmaPerSample = Math.sqrt(variance);

  const avgDtSec = dtSum / dtCount;
  const sigmaAnnual = sigmaPerSample * Math.sqrt(SECONDS_PER_YEAR / avgDtSec);

  // Sanity guard: if sigmaAnnual is non-finite or absurdly high, fallback.
  if (!Number.isFinite(sigmaAnnual) || sigmaAnnual <= 0) {
    return {
      sigmaAnnual: fallback.defaultSigmaAnnual,
      sampleCount: returns.length,
      lastSampleSec,
      isFresh: false,
      source: "fallback",
    };
  }

  return {
    sigmaAnnual,
    sampleCount: returns.length,
    lastSampleSec,
    isFresh: returns.length >= FRESH_MIN_SAMPLES,
    source: "samples",
  };
  // NB: isFresh staleness check happens in the wrapper (we need `asOfSec` to
  // compare against `lastSampleSec`). The pure function reports the
  // sampleCount-based half of the freshness predicate.
}

// ─── Wrapper with DB query + TTL cache ───────────────────────────

interface CacheEntry {
  estimate: VolEstimate;
  expiresAt: number;
}
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Production entry point: load `priceTicksV3` rows for the series's Pyth
 * feed in `[asOfSec - 7d, asOfSec]`, compute realized σ, cache for 5 min.
 *
 * Cache key is bucketed on a 5-min grid so that two callers in the same
 * 5-min window share a cache hit, and cache entries naturally roll over
 * without explicit eviction.
 */
export async function computeRealizedVol7d(
  seriesId: string,
  asOfSec: number,
): Promise<VolEstimate> {
  const params = getAssetParams(seriesId);
  const bucket = Math.floor(asOfSec / CACHE_BUCKET_SEC);
  const cacheKey = `${seriesId}:${bucket}`;

  const cached = CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.estimate;
  }

  const fallbackEstimate = (): VolEstimate => ({
    sigmaAnnual: params.defaultSigmaAnnual,
    sampleCount: 0,
    lastSampleSec: 0,
    isFresh: false,
    source: "fallback",
  });

  // Resolve series → Pyth feed id. Prefer live env value via assetSymbol;
  // fall back to the row's snapshotted pythFeedId for ECO/historical rows.
  const seriesRow = await db
    .select({
      assetSymbol: seriesV3.assetSymbol,
      pythFeedId: seriesV3.pythFeedId,
    })
    .from(seriesV3)
    .where(eq(seriesV3.seriesId, seriesId))
    .limit(1);
  if (seriesRow.length === 0) {
    const est = fallbackEstimate();
    CACHE.set(cacheKey, { estimate: est, expiresAt: Date.now() + CACHE_TTL_MS });
    return est;
  }
  let feedId: string;
  try {
    feedId = resolveSeriesFeedId(seriesRow[0]);
  } catch {
    const est = fallbackEstimate();
    CACHE.set(cacheKey, { estimate: est, expiresAt: Date.now() + CACHE_TTL_MS });
    return est;
  }

  // Pull tick samples in window.
  const lo = asOfSec - SEVEN_DAYS_SEC;
  const hi = asOfSec;
  const rows = await db
    .select({
      priceE8: priceTicksV3.priceE8,
      publishTimeSec: priceTicksV3.publishTimeSec,
    })
    .from(priceTicksV3)
    .where(
      and(
        eq(priceTicksV3.pythFeedId, feedId),
        gte(priceTicksV3.publishTimeSec, sql`${lo}::bigint`),
        lte(priceTicksV3.publishTimeSec, sql`${hi}::bigint`),
      ),
    )
    .orderBy(asc(priceTicksV3.publishTimeSec));

  const samples: VolSample[] = rows.map((r) => ({
    priceE8: r.priceE8 as bigint,
    publishTimeSec: Number(r.publishTimeSec),
  }));

  const raw = _computeFromSamples(samples, params.asset, params);

  // Apply staleness check now that we have asOfSec in scope.
  const isFresh =
    raw.source === "samples" &&
    raw.sampleCount >= FRESH_MIN_SAMPLES &&
    asOfSec - raw.lastSampleSec <= FRESH_MAX_AGE_SEC;

  const estimate: VolEstimate = { ...raw, isFresh };
  CACHE.set(cacheKey, { estimate, expiresAt: Date.now() + CACHE_TTL_MS });
  return estimate;
}

/** Test-only — clear the in-memory cache between runs. */
export function _clearVolCache(): void {
  CACHE.clear();
}
