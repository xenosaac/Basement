/**
 * Barrier strike formula — Basement v0.5 Phase B.
 *
 * Given current spot `P0`, annualised σ, and tenor `T`, the price-move size
 * for the round is:
 *
 *     σ_tenor = σ_annual · √(T / SECONDS_PER_YEAR)
 *     X       = z · σ_tenor · k_fat                  // fractional move
 *     X       = clamp(X, minStrikeBps/1e4, maxStrikeBps/1e4)
 *     UP      → strike = P0 · (1 + X)
 *     DOWN    → strike = P0 · (1 − X)
 *
 * z=1.28 is the one-tail 90% Normal quantile → ~80% expected seller win-rate
 * after the `k_fat` tail-fattener. Clamp guards against vol regime extremes
 * (post-FOMC σ spike → unbounded X) and σ collapse (overnight calm σ → 0
 * yields a meaningless ±0bps strike).
 *
 * Pure function — no IO, no globals, fully deterministic given inputs.
 */

import type { BarrierStrikeInput, BarrierStrikeResult } from "./types";
import { getAssetParams } from "./asset-params";

/** Plain calendar year in seconds. Matches `vol-estimator.ts` annualisation. */
export const SECONDS_PER_YEAR = 365 * 86400;

const DEFAULT_Z = 1.28;

export function computeBarrierStrike(
  input: BarrierStrikeInput,
): BarrierStrikeResult {
  const { asset, side, tenorSec, P0, sigmaAnnual, z: zIn } = input;

  if (!(tenorSec > 0)) {
    throw new Error("computeBarrierStrike: tenorSec must be positive");
  }
  if (!(P0 > 0)) {
    throw new Error("computeBarrierStrike: P0 must be positive");
  }
  if (!(sigmaAnnual > 0)) {
    throw new Error("computeBarrierStrike: sigmaAnnual must be positive");
  }

  const params = getAssetParams(asset);
  const z = zIn ?? DEFAULT_Z;
  const kFat = params.kFat;

  const sigmaTenor = sigmaAnnual * Math.sqrt(tenorSec / SECONDS_PER_YEAR);
  const xRaw = z * sigmaTenor * kFat;

  const minX = params.minStrikeBps / 10_000;
  const maxX = params.maxStrikeBps / 10_000;

  let x = xRaw;
  let clamp: BarrierStrikeResult["clamp"] = "none";
  if (x < minX) {
    x = minX;
    clamp = "min";
  } else if (x > maxX) {
    x = maxX;
    clamp = "max";
  }

  const strikePrice = side === "UP" ? P0 * (1 + x) : P0 * (1 - x);
  const strikeBps = Math.round(x * 10_000);
  const xPercent = x * 100;

  return { strikePrice, strikeBps, xPercent, clamp, z, kFat };
}
