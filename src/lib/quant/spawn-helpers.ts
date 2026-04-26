/**
 * Spawn shadow helper — Basement v0.5 Phase F-2.
 *
 * Single source for the strike-kind / barrier / vol shadow that BOTH the
 * `spawn-recurring` cron AND the `/api/series` lazy-spawn path consume when
 * writing a fresh `cases_v3` row (or `markets` mirror via DynamicStrikeUpsert).
 *
 * Before Phase F-2 each path computed its own shadow:
 *   - cron path: full quant pipeline (vol-estimator + barrier-strike + macro
 *                blackout) writing strikeKindCaptured / barrier_*_price_e8.
 *   - lazy-spawn path: wrote `strikePriceE8 = livePrice.priceE8` and skipped
 *                      every other column → all new lazy rows had NULL
 *                      strikeKindCaptured / barrier columns, regardless of
 *                      the series's strikeKind. Result: front-end fell back
 *                      to "rise/fall" copy on absolute_above series.
 *
 * `computeSpawnShadow` is the unified extraction. Both callers feed in
 * groupId + livePriceRaw + nowUtcSec; the helper branches on
 * `spawnStrategy.strikeKind` and returns the locked SpawnShadow contract.
 *
 * IMPORTANT — silent-fallback discipline (CLAUDE.md "No silent fallback"):
 *   - Unknown groupId             → throws (caller must skip-with-log).
 *   - Unknown asset symbol        → `getAssetParams` throws.
 *   - Vol estimator no samples    → resolved INSIDE `computeRealizedVol7d`
 *                                   via `defaultSigmaAnnual`; we propagate
 *                                   `volSourceTag` / `volIsFresh` so audit
 *                                   trail records the fallback.
 *   - Pyth Hermes 503 / NaN price → caller-side concern. Caller must skip
 *                                   when livePriceRaw is missing rather than
 *                                   feeding a sentinel into this helper.
 */

import {
  groupById,
  nextNyFourPmUtc,
  nextNyMidnightUtc,
  nextNyNoonUtc,
  nextQuarterHourUtc,
  nextTopOfHourUtc,
  type MarketGroupSpec,
} from "@/lib/market-groups";
import { computeBarrierStrike } from "@/lib/quant/barrier-strike";
import { computeRealizedVol7d } from "@/lib/quant/vol-estimator";

/**
 * Locked output contract — consumed by `cases_v3` insert sites and any
 * future caller that needs the shadow shape. Field names are stable across
 * F-2/F-3/F-5; do NOT rename without coordinating with downstream slots.
 */
export interface SpawnShadow {
  strikeKind:
    | "rise_fall"
    | "absolute_above"
    | "absolute_below"
    | "barrier_two_sided";
  /** Raw at the feed's native expo (XAU: -3, QQQ/NVDA: -5, crypto: -8).
   *  Despite the field name `strikePriceE8` (mirroring the `cases_v3.strike_price_e8`
   *  column name), the value is NOT pre-converted to e-8 — F-3's renderer
   *  divides by 10^|priceExpo| at display time. The "e8" suffix is a
   *  historical naming bug we keep for column-parity. */
  strikePriceE8: bigint;
  /** Lower barrier price (raw at feed expo). NULL except for
   *  `absolute_below` (the trigger) and `barrier_two_sided` (the lower leg). */
  barrierLowPriceE8: bigint | null;
  /** Upper barrier price (raw at feed expo). NULL except for
   *  `absolute_above` (the trigger) and `barrier_two_sided` (the upper leg). */
  barrierHighPriceE8: bigint | null;
  /** 'samples' | 'fallback' | 'rise_fall' (rise_fall = vol not consulted). */
  volSourceTag: string;
  /** True when vol came from ≥50 recent ticks within freshness window. */
  volIsFresh: boolean;
}

export interface ComputeSpawnShadowArgs {
  /** Registry groupId. Must exist in MARKET_GROUPS. */
  groupId: string;
  /** Live spot price as raw integer at the feed's native expo. */
  livePriceRaw: bigint;
  /** Wall clock for tenor / vol-window / anchor maths. */
  nowUtcSec: number;
}

/** Map a closeAnchor literal → the next anchor in UTC seconds. Mirrors the
 *  cron's local helper so both paths share one source. */
function resolveAnchorUtcSec(
  anchor:
    | "next-15m"
    | "next-1h"
    | "daily-ny-noon"
    | "daily-ny-4pm"
    | "daily-ny-midnight",
  nowUtcSec: number,
): number {
  switch (anchor) {
    case "next-15m":
      return nextQuarterHourUtc(nowUtcSec);
    case "next-1h":
      return nextTopOfHourUtc(nowUtcSec);
    case "daily-ny-noon":
      return nextNyNoonUtc(nowUtcSec);
    case "daily-ny-4pm":
      return nextNyFourPmUtc(nowUtcSec);
    case "daily-ny-midnight":
      return nextNyMidnightUtc(nowUtcSec);
  }
}

/** Convert a raw price at `priceExpo` to its USD-float representation. */
function priceRawToUsd(raw: bigint, priceExpo: number): number {
  return Number(raw) * Math.pow(10, priceExpo);
}

/** Convert a USD-float strike back to raw integer at the feed's native expo.
 *  Used to emit `strikePriceE8` / barrier columns at column-native scale. */
function usdToPriceRaw(usd: number, priceExpo: number): bigint {
  // priceExpo is negative (e.g. -3 → multiply by 1000 to get raw integer).
  const scale = Math.pow(10, -priceExpo);
  return BigInt(Math.round(usd * scale));
}

/**
 * Compute the SpawnShadow for a market group at the given moment. Branches
 * on the registered `spawnStrategy.strikeKind`:
 *
 * - `rise_fall`           → strike = livePriceRaw (no quant input, vol skipped).
 *                           Covers `spawn_recurring_3min` + legacy `create_market`
 *                           groups whose strategy doesn't carry a strikeKind.
 * - `absolute_above`      → strike = P0·(1 + X) at side="UP".
 *                           barrierHigh = strike, barrierLow = null.
 * - `absolute_below`      → strike = P0·(1 − X) at side="DOWN".
 *                           barrierLow = strike, barrierHigh = null.
 *                           `strikePriceE8` mirrors `barrierLow` (chain parity).
 * - `barrier_two_sided`   → both UP + DOWN strikes computed with same σ.
 *                           strikePriceE8 = upper (chain-display parity).
 */
export async function computeSpawnShadow(
  args: ComputeSpawnShadowArgs,
): Promise<SpawnShadow> {
  const { groupId, livePriceRaw, nowUtcSec } = args;
  const spec = groupById(groupId);
  if (!spec) {
    // Per CLAUDE.md "No silent fallback": never silently degrade an unknown
    // group to rise_fall — caller must catch + log + skip-spawn.
    throw new Error(
      `[computeSpawnShadow] unknown groupId "${groupId}" (not in MARKET_GROUPS)`,
    );
  }

  if (livePriceRaw <= 0n) {
    throw new Error(
      `[computeSpawnShadow] non-positive livePriceRaw ${livePriceRaw} for ${groupId}`,
    );
  }

  const strategy = spec.spawnStrategy;

  // ─── Branch: legacy / rise_fall strategies ───────────────────────────
  // Both `spawn_recurring_3min` and the pre-v0.5 `create_market` strategy
  // are directional close-vs-open semantics. The shadow records strikePriceE8
  // = livePriceRaw, no barrier columns, and tags vol as "rise_fall" (audit
  // marker — distinguishes from genuine `samples`/`fallback` cases).
  if (strategy.kind !== "create_market_dynamic_strike") {
    return {
      strikeKind: "rise_fall",
      strikePriceE8: livePriceRaw,
      barrierLowPriceE8: null,
      barrierHighPriceE8: null,
      volSourceTag: "rise_fall",
      volIsFresh: false,
    };
  }

  // ─── Branch: dynamic-strike strategies ───────────────────────────────
  const closeTimeSec = resolveAnchorUtcSec(strategy.closeAnchor, nowUtcSec);
  const tenorSec = closeTimeSec - nowUtcSec;
  if (!(tenorSec > 0)) {
    throw new Error(
      `[computeSpawnShadow] non-positive tenor ${tenorSec}s for ${groupId} ` +
        `(anchor=${strategy.closeAnchor})`,
    );
  }

  // Vol estimate uses seriesId == groupId by Phase D convention. The
  // estimator silently falls back to per-asset default σ when samples<5 —
  // that's an explicit design choice (vol-estimator records source='fallback'
  // so the audit trail makes the degradation visible).
  const vol = await computeRealizedVol7d(spec.groupId, nowUtcSec);

  // Convert spot to USD-float for the barrier-strike formula. The cron
  // historically asserted `priceExpo === strategy.pythExpo` here; we trust
  // the registry's `spec.priceExpo` (single source) and let the caller
  // validate Pyth's actual expo at fetch time.
  const P0Usd = priceRawToUsd(livePriceRaw, spec.priceExpo);
  if (!(P0Usd > 0)) {
    throw new Error(
      `[computeSpawnShadow] non-positive P0Usd=${P0Usd} from livePriceRaw=` +
        `${livePriceRaw} expo=${spec.priceExpo} for ${groupId}`,
    );
  }

  const baseInput = {
    asset: spec.assetSymbol,
    tenorSec,
    P0: P0Usd,
    sigmaAnnual: vol.sigmaAnnual,
    asOfSec: nowUtcSec,
  };

  if (strategy.strikeKind === "barrier_two_sided") {
    const up = computeBarrierStrike({ ...baseInput, side: "UP" });
    const down = computeBarrierStrike({ ...baseInput, side: "DOWN" });
    const upperRaw = usdToPriceRaw(up.strikePrice, spec.priceExpo);
    const lowerRaw = usdToPriceRaw(down.strikePrice, spec.priceExpo);
    return {
      strikeKind: "barrier_two_sided",
      // Chain-display parity (matches existing cron convention at line 224):
      // upper barrier doubles as the chain `strike_price` placeholder.
      strikePriceE8: upperRaw,
      barrierHighPriceE8: upperRaw,
      barrierLowPriceE8: lowerRaw,
      volSourceTag: vol.source,
      volIsFresh: vol.isFresh,
    };
  }

  if (strategy.strikeKind === "absolute_above") {
    const up = computeBarrierStrike({ ...baseInput, side: "UP" });
    const strikeRaw = usdToPriceRaw(up.strikePrice, spec.priceExpo);
    return {
      strikeKind: "absolute_above",
      strikePriceE8: strikeRaw,
      barrierHighPriceE8: strikeRaw,
      barrierLowPriceE8: null,
      volSourceTag: vol.source,
      volIsFresh: vol.isFresh,
    };
  }

  if (strategy.strikeKind === "absolute_below") {
    const down = computeBarrierStrike({ ...baseInput, side: "DOWN" });
    const strikeRaw = usdToPriceRaw(down.strikePrice, spec.priceExpo);
    return {
      strikeKind: "absolute_below",
      // Chain-side `strike_price` mirrors the BELOW trigger so on-chain
      // display still shows the "right" number; barrierLow is the source of
      // truth for v0 settle-side reads.
      strikePriceE8: strikeRaw,
      barrierLowPriceE8: strikeRaw,
      barrierHighPriceE8: null,
      volSourceTag: vol.source,
      volIsFresh: vol.isFresh,
    };
  }

  // Exhaustive guard — TS narrows `strategy.strikeKind` to never here.
  const _exhaustive: never = strategy.strikeKind;
  throw new Error(
    `[computeSpawnShadow] unhandled strikeKind ${String(_exhaustive)} for ${groupId}`,
  );
}

// Re-export the spec type so callers can pass through MarketGroupSpec
// references without importing market-groups.ts directly.
export type { MarketGroupSpec };
