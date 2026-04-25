/**
 * Basement v0.5 / Phase E — Barrier two-sided settle logic.
 *
 * Pure function: given the close-time price and the case's two barriers
 * (low + high), decide UP / DOWN. Mirrors the event-resolve.ts style
 * (no DB / no clock / no network — easy to unit test).
 *
 * Product semantics ("Will <ASSET> break out of $low – $high in <tenor>?"):
 *   - YES (UP)   = price breached EITHER barrier (closeE8 >= high OR closeE8 <= low)
 *   - NO  (DOWN) = price stayed strictly inside the range (low < closeE8 < high)
 *
 * Boundary policy: INCLUSIVE at both barriers (price == high → UP, price == low → UP).
 * Choosing inclusive matches the cards' framing ("break out of $low – $high"): if
 * the price reaches the boundary, the breakout has occurred. It also avoids a
 * pathological INVALID class that would otherwise force VOID on exact tag-up.
 *
 * Compare to `parimutuel.computeOutcome`, which uses strict inequality and
 * emits INVALID on exact equality. Barrier outcomes never emit INVALID — the
 * exit rule deterministically resolves the boundary case to UP.
 */

export type BarrierOutcomeTag = "UP" | "DOWN";

/**
 * Two-sided knock-in barrier outcome.
 *
 * @param closePriceE8       Settle price at case close (Pyth e8 fixed-point;
 *                           same units as `casesV3.strikePriceE8`).
 * @param barrierLowPriceE8  Lower barrier (P0 × (1 − X) at spawn time).
 * @param barrierHighPriceE8 Upper barrier (P0 × (1 + X) at spawn time).
 * @returns "UP" if price breached either barrier (inclusive), else "DOWN".
 *
 * Throws if barriers are inverted (`high < low`) — that's a spawn-time bug and
 * should not be silently coerced into a meaningless settle.
 */
export function computeBarrierOutcome(
  closePriceE8: bigint,
  barrierLowPriceE8: bigint,
  barrierHighPriceE8: bigint,
): BarrierOutcomeTag {
  if (barrierHighPriceE8 < barrierLowPriceE8) {
    throw new Error(
      `barrier inverted: high=${barrierHighPriceE8} < low=${barrierLowPriceE8}`,
    );
  }
  return closePriceE8 >= barrierHighPriceE8 ||
    closePriceE8 <= barrierLowPriceE8
    ? "UP"
    : "DOWN";
}
