import { describe, expect, it } from "vitest";

import { computeBarrierOutcome } from "@/lib/barrier-resolve";

// Use realistic SOL-15m-style numbers: P0 = $148.32, X ≈ 0.6%
//   low  = 148.32 × (1 - 0.006) = 147.43
//   high = 148.32 × (1 + 0.006) = 149.21
const LOW = 14_743_000_000n; // $147.43 at e8
const HIGH = 14_921_000_000n; // $149.21 at e8

describe("computeBarrierOutcome", () => {
  it("price slightly above the upper barrier → UP (breakout)", () => {
    expect(computeBarrierOutcome(HIGH + 1n, LOW, HIGH)).toBe("UP");
  });

  it("price slightly below the lower barrier → UP (breakout)", () => {
    expect(computeBarrierOutcome(LOW - 1n, LOW, HIGH)).toBe("UP");
  });

  it("price strictly inside the range → DOWN (stay-in)", () => {
    const mid = (LOW + HIGH) / 2n;
    expect(computeBarrierOutcome(mid, LOW, HIGH)).toBe("DOWN");
  });

  it("price exactly at the upper barrier → UP (inclusive)", () => {
    expect(computeBarrierOutcome(HIGH, LOW, HIGH)).toBe("UP");
  });

  it("price exactly at the lower barrier → UP (inclusive)", () => {
    expect(computeBarrierOutcome(LOW, LOW, HIGH)).toBe("UP");
  });

  it("just-inside boundaries (low+1, high-1) → DOWN", () => {
    expect(computeBarrierOutcome(LOW + 1n, LOW, HIGH)).toBe("DOWN");
    expect(computeBarrierOutcome(HIGH - 1n, LOW, HIGH)).toBe("DOWN");
  });

  it("degenerate equal barriers (low === high) → always UP", () => {
    // Range of width zero: any price is either at-or-above high or at-or-below low.
    expect(computeBarrierOutcome(HIGH - 1n, HIGH, HIGH)).toBe("UP");
    expect(computeBarrierOutcome(HIGH, HIGH, HIGH)).toBe("UP");
    expect(computeBarrierOutcome(HIGH + 1n, HIGH, HIGH)).toBe("UP");
  });

  it("inverted barriers (high < low) → throws (spawn-time bug)", () => {
    expect(() => computeBarrierOutcome(LOW, HIGH, LOW)).toThrow(
      /barrier inverted/,
    );
  });

  it("works on tiny BTC-scale e8 numbers (sanity)", () => {
    const lo = 6_500_000_000_000n; // $65,000 at e8
    const hi = 6_700_000_000_000n; // $67,000 at e8
    expect(computeBarrierOutcome(6_400_000_000_000n, lo, hi)).toBe("UP"); // below low
    expect(computeBarrierOutcome(6_600_000_000_000n, lo, hi)).toBe("DOWN"); // inside
    expect(computeBarrierOutcome(6_800_000_000_000n, lo, hi)).toBe("UP"); // above high
  });
});
