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
 * z is solved as Φ⁻¹(1 − targetTouchProb). Default `targetTouchProb = 0.30`
 * gives z ≈ 0.524 in close-only mode (P(close > strike) ≈ 0.30, i.e. 70/30
 * seller/buyer edge). The solver lives in `inverseNormalCdf` below
 * (Acklam rational approximation, precision ~1e-7). Callers can override
 * the implicit z either by passing `z` directly to `computeBarrierStrike`
 * or by setting `targetTouchProb` on the asset's `AssetParams` row in
 * `asset-params.ts`. Clamp guards against vol regime extremes (post-FOMC
 * σ spike → unbounded X) and σ collapse (overnight calm σ → 0 yields a
 * meaningless ±0bps strike).
 *
 * Pure function — no IO, no globals, fully deterministic given inputs.
 */

import type { BarrierStrikeInput, BarrierStrikeResult } from "./types";
import { getAssetParams } from "./asset-params";

/** Plain calendar year in seconds. Matches `vol-estimator.ts` annualisation. */
export const SECONDS_PER_YEAR = 365 * 86400;

/**
 * Default close-only YES probability when neither `input.z` nor
 * `params.targetTouchProb` is supplied. 0.30 = 70/30 seller/buyer edge.
 */
export const DEFAULT_TARGET_TOUCH_PROB = 0.30;

/**
 * Inverse standard-normal CDF (quantile function). Acklam's rational
 * approximation — relative error |ε| < 1.15e-9 over the full open interval.
 * Throws on `p ≤ 0 || p ≥ 1` (the quantile is ±∞ at the bounds).
 *
 * Reference: P. J. Acklam, "An algorithm for computing the inverse normal
 * cumulative distribution function" (2003), table 1 + table 2 coefficients.
 */
export function inverseNormalCdf(p: number): number {
  if (!(p > 0 && p < 1)) {
    throw new Error(
      `inverseNormalCdf: p must be in (0, 1) exclusive, got ${p}`,
    );
  }

  // Coefficients for the rational approximation.
  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.383577518672690e2,
    -3.066479806614716e1,
    2.506628277459239e0,
  ];
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838e0,
    -2.549732539343734e0,
    4.374664141464968e0,
    2.938163982698783e0,
  ];
  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996e0,
    3.754408661907416e0,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number;
  let r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/**
 * Solve z such that P(Z > z) = target ⇔ z = Φ⁻¹(1 − target).
 * For `target = 0.30` → z ≈ 0.5244005.
 */
export function defaultZFor(target: number): number {
  return inverseNormalCdf(1 - target);
}

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
  const target = params.targetTouchProb ?? DEFAULT_TARGET_TOUCH_PROB;
  const z = zIn ?? defaultZFor(target);
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
