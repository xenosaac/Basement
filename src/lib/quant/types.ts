/**
 * Shared types for the quant module — Basement v0.5.
 *
 * Consumed by Phase B (vol-estimator / barrier-strike / macro-calendar /
 * market-maker / asset-params) and Phases C–G downstream callers (cron,
 * spawn helpers, settle path).
 */

/** Realized-vol estimator output. `sigmaAnnual` is dimensionless (annualised
 *  log-return σ). `isFresh` = enough recent samples to trust; `source` records
 *  whether the value came from `priceTicksV3` samples or fell back to
 *  per-asset defaults. */
export interface VolEstimate {
  sigmaAnnual: number;
  sampleCount: number;
  /** Unix sec of the most recent tick used. 0 when source==='fallback'. */
  lastSampleSec: number;
  isFresh: boolean;
  source: "samples" | "fallback";
}

/** Input to `computeBarrierStrike`. `P0` is current spot in USD floats (not
 *  cents, not e8). `tenorSec` is round duration in seconds. `sigmaAnnual` is
 *  the realized-vol estimate (or per-asset default fallback). */
export interface BarrierStrikeInput {
  asset: string;
  side: "UP" | "DOWN";
  tenorSec: number;
  P0: number;
  sigmaAnnual: number;
  asOfSec: number;
  /** z-quantile for the barrier crossing probability. When undefined the
   *  solver picks `Φ⁻¹(1 − targetTouchProb)`; default `targetTouchProb = 0.30`
   *  gives z ≈ 0.524 (P(close > strike) ≈ 30%, 70/30 seller/buyer edge). */
  z?: number;
}

/** Output of `computeBarrierStrike`. `strikeBps` is X expressed in basis
 *  points (round, integer). `clamp` reports whether the [min,max] guard
 *  fired. */
export interface BarrierStrikeResult {
  strikePrice: number;
  strikeBps: number;
  xPercent: number;
  clamp: "min" | "max" | "none";
  z: number;
  kFat: number;
}

/** Per-asset quant defaults. Loaded from `ASSET_PARAMS` table; consumed by
 *  vol-estimator (fallback σ) and barrier-strike (kFat + clamp).
 *  `targetTouchProb` is optional: when set, overrides the global
 *  `DEFAULT_TARGET_TOUCH_PROB = 0.30` for that asset, letting individual
 *  markets dial the seller/buyer edge (e.g. 0.40 for tighter buyer odds). */
export interface AssetParams {
  asset: string;
  defaultSigmaAnnual: number;
  kFat: number;
  minStrikeBps: number;
  maxStrikeBps: number;
  targetTouchProb?: number;
}

/** Macro-calendar blackout decision. Cron callers `if (blackout) skip`. */
export interface BlackoutResult {
  blackout: boolean;
  reason?: string;
  clearAtSec?: number;
}

/** ABOVE/BELOW direction marker for ECO event-driven series (Phase G).
 *  Distinct from rolling barrier `side` because semantics differ. */
export type EventDirection = "ABOVE" | "BELOW";
