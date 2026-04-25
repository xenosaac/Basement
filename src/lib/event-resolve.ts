/**
 * Basement v0.5 / Phase G — ECO event-driven settle logic.
 *
 * Pure function: given a Pyth tick + the case's event-driven context, decide
 * UP / DOWN / INVALID and whether the result should be persisted now or
 * retried on the next eco-settle cron tick.
 *
 * Three VOID classes (writeDb=true except pre_release_tick which is retry):
 *   - "pre_release_tick": Pyth published before release_time → retry later
 *   - "no_publish":       release_time + settleMaxAgeSec passed without a
 *                         fresh tick (e.g. data source down / oracle stalled)
 *   - "low_confidence":   Pyth conf interval > 1% of price (publisher quorum
 *                         disagreement) — refuse to settle
 *
 * Direction handling:
 *   - direction "ABOVE": YES wins iff price > strike → outcome=UP, else DOWN
 *   - direction "BELOW": YES wins iff price < strike → outcome=DOWN, else UP
 *
 * Caller (eco-settle cron) is responsible for translating the EcoOutcome
 * into DB writes (cases.resolvedOutcome / actualReleasedPriceE8 / voidReason
 * / state) and user position settle.
 *
 * No DB / no network / no clock — all inputs explicit. Easy to unit-test.
 */

export type EcoOutcomeTag = "UP" | "DOWN" | "INVALID";
export type EcoVoidReason = "pre_release_tick" | "no_publish" | "low_confidence";

export interface EcoOutcome {
  outcome: EcoOutcomeTag;
  /** Set when outcome=INVALID; explains which void class fired. */
  voidReason?: EcoVoidReason;
  /** false → caller should NOT persist; retry on next tick. true → persist. */
  writeDb: boolean;
}

export interface PythTick {
  /** Pyth fixed-point e8 price (signed in Pyth, but ECO feeds are non-neg). */
  priceE8: bigint;
  /** Unix seconds when Pyth aggregated this price. */
  publishTimeSec: number;
  /** Confidence interval, same exponent as priceE8. */
  conf: bigint;
}

export interface EventDrivenContext {
  /** Scheduled BLS/BEA release time (Unix seconds). */
  releaseTimeSec: number;
  /** Hard ceiling: now − releaseTimeSec > settleMaxAgeSec → no_publish VOID. */
  settleMaxAgeSec: number;
  /** "ABOVE": YES wins when price > strike. "BELOW": YES wins when price < strike. */
  direction: "ABOVE" | "BELOW";
  /** Strike threshold, e8 native (must match feed expo, typically -8). */
  strikePriceE8: bigint;
}

/**
 * Compute ECO outcome given the latest Pyth tick. Pure / deterministic.
 *
 * Decision tree (order matters):
 *   1. Pyth tick published BEFORE release_time → INVALID + pre_release_tick,
 *      writeDb=false (we have not heard the official release yet — try again).
 *   2. now > release_time + settleMaxAgeSec → INVALID + no_publish, writeDb=true
 *      (we waited the full window; give up and VOID — refund cost basis).
 *   3. conf * 100 > price → INVALID + low_confidence, writeDb=true
 *      (Pyth aggregator low-quality publish — settling on this would be unfair).
 *   4. Otherwise compare priceE8 vs strikePriceE8 according to `direction`.
 *
 * Edge case: priceE8 === strikePriceE8 is treated as "not above", so for
 * direction=ABOVE → outcome=DOWN. (Plans/spec do not single this case out;
 * the strict-inequality default matches the rolling parimutuel computeOutcome
 * tie-break behaviour where exact match → INVALID — but for ECO we prefer a
 * deterministic side rather than a refund VOID, so we default to "below".)
 */
export function computeEcoOutcome(
  ctx: EventDrivenContext,
  pythTick: PythTick,
  nowSec: number,
): EcoOutcome {
  // (1) Pre-release: the Pyth feed has not yet observed the official print.
  // Caller should retry on the next eco-settle pass.
  if (pythTick.publishTimeSec < ctx.releaseTimeSec) {
    return {
      outcome: "INVALID",
      voidReason: "pre_release_tick",
      writeDb: false,
    };
  }

  // (2) Stale-window: release happened, but no fresh data within max age.
  if (nowSec - ctx.releaseTimeSec > ctx.settleMaxAgeSec) {
    return {
      outcome: "INVALID",
      voidReason: "no_publish",
      writeDb: true,
    };
  }

  // (3) Low-confidence: refuse to settle on a wide Pyth aggregate.
  // Threshold: conf > 1% of price (i.e. conf * 100 > price).
  if (pythTick.conf * 100n > pythTick.priceE8) {
    return {
      outcome: "INVALID",
      voidReason: "low_confidence",
      writeDb: true,
    };
  }

  // (4) Final compare.
  const above = pythTick.priceE8 > ctx.strikePriceE8;
  if (ctx.direction === "ABOVE") {
    return { outcome: above ? "UP" : "DOWN", writeDb: true };
  }
  // direction === "BELOW": YES wins iff price < strike → outcome=UP when below,
  // DOWN when at-or-above. Equality ties go to DOWN (consistent with ABOVE).
  return { outcome: above ? "DOWN" : "UP", writeDb: true };
}
