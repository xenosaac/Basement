import { describe, expect, it } from "vitest";
import {
  computeEcoOutcome,
  type EventDrivenContext,
  type PythTick,
} from "@/lib/event-resolve";

const RELEASE = 1_777_552_200; // 2026-04-30 12:30 UTC (matches seed)
const STRIKE_E8 = 30_000_000n; // 0.30%

const baseCtx: EventDrivenContext = {
  releaseTimeSec: RELEASE,
  settleMaxAgeSec: 1800,
  direction: "ABOVE",
  strikePriceE8: STRIKE_E8,
};

function tick(
  overrides: Partial<PythTick> & { publishTimeSec: number; priceE8: bigint },
): PythTick {
  return {
    conf: 100_000n, // ~0.001% of strike-magnitude — well below the 1% threshold
    ...overrides,
  };
}

describe("computeEcoOutcome", () => {
  it("pre_release_tick — Pyth published before release: do not write, retry", () => {
    const out = computeEcoOutcome(
      baseCtx,
      tick({ publishTimeSec: RELEASE - 30, priceE8: 50_000_000n }),
      RELEASE - 5, // now still pre-release
    );
    expect(out.outcome).toBe("INVALID");
    expect(out.voidReason).toBe("pre_release_tick");
    expect(out.writeDb).toBe(false);
  });

  it("pre_release_tick fires even when now > release (publish time is the gate)", () => {
    // Pyth has not caught up; the publish_time is still pre-release. The
    // settler must keep retrying until Pyth observes the release.
    const out = computeEcoOutcome(
      baseCtx,
      tick({ publishTimeSec: RELEASE - 1, priceE8: 50_000_000n }),
      RELEASE + 60,
    );
    expect(out.outcome).toBe("INVALID");
    expect(out.voidReason).toBe("pre_release_tick");
    expect(out.writeDb).toBe(false);
  });

  it("no_publish — release + settleMaxAgeSec passed: VOID + write", () => {
    const out = computeEcoOutcome(
      baseCtx,
      // pretend Pyth never reported a fresh tick — we still pass a tick
      // with old-ish publish_time that's >= release just to satisfy gate (1).
      tick({ publishTimeSec: RELEASE, priceE8: 50_000_000n }),
      RELEASE + 1801, // 1s past max-age
    );
    expect(out.outcome).toBe("INVALID");
    expect(out.voidReason).toBe("no_publish");
    expect(out.writeDb).toBe(true);
  });

  it("low_confidence — conf > 1% of price: VOID + write", () => {
    const out = computeEcoOutcome(
      baseCtx,
      tick({
        publishTimeSec: RELEASE + 30,
        priceE8: 50_000_000n,
        conf: 600_000n, // 1.2% of 5e7 → triggers
      }),
      RELEASE + 60,
    );
    expect(out.outcome).toBe("INVALID");
    expect(out.voidReason).toBe("low_confidence");
    expect(out.writeDb).toBe(true);
  });

  it("ABOVE direction — price strictly above strike → UP", () => {
    const out = computeEcoOutcome(
      baseCtx,
      tick({ publishTimeSec: RELEASE + 30, priceE8: STRIKE_E8 + 1n }),
      RELEASE + 60,
    );
    expect(out).toEqual({ outcome: "UP", writeDb: true });
  });

  it("ABOVE direction — price below strike → DOWN", () => {
    const out = computeEcoOutcome(
      baseCtx,
      tick({ publishTimeSec: RELEASE + 30, priceE8: STRIKE_E8 - 1n }),
      RELEASE + 60,
    );
    expect(out).toEqual({ outcome: "DOWN", writeDb: true });
  });

  it("ABOVE direction — equality is treated as not-above → DOWN", () => {
    const out = computeEcoOutcome(
      baseCtx,
      tick({ publishTimeSec: RELEASE + 30, priceE8: STRIKE_E8 }),
      RELEASE + 60,
    );
    expect(out).toEqual({ outcome: "DOWN", writeDb: true });
  });

  it("BELOW direction — price strictly below strike → UP (YES wins)", () => {
    const out = computeEcoOutcome(
      { ...baseCtx, direction: "BELOW" },
      tick({ publishTimeSec: RELEASE + 30, priceE8: STRIKE_E8 - 1n }),
      RELEASE + 60,
    );
    expect(out).toEqual({ outcome: "UP", writeDb: true });
  });

  it("BELOW direction — price above strike → DOWN", () => {
    const out = computeEcoOutcome(
      { ...baseCtx, direction: "BELOW" },
      tick({ publishTimeSec: RELEASE + 30, priceE8: STRIKE_E8 + 1n }),
      RELEASE + 60,
    );
    expect(out).toEqual({ outcome: "DOWN", writeDb: true });
  });

  it("boundary — exactly at settleMaxAgeSec is NOT yet no_publish", () => {
    // Strict greater-than per impl: nowSec - release > maxAge.
    const out = computeEcoOutcome(
      baseCtx,
      tick({ publishTimeSec: RELEASE + 30, priceE8: STRIKE_E8 + 5n }),
      RELEASE + 1800, // exactly at the boundary
    );
    expect(out.outcome).toBe("UP");
    expect(out.voidReason).toBeUndefined();
    expect(out.writeDb).toBe(true);
  });

  it("boundary — conf * 100 == price is NOT low_confidence (strict gt)", () => {
    const out = computeEcoOutcome(
      baseCtx,
      tick({
        publishTimeSec: RELEASE + 30,
        priceE8: 50_000_000n,
        conf: 500_000n, // exactly 1%
      }),
      RELEASE + 60,
    );
    // Should fall through to outcome compare (50_000_000 > 30_000_000 → UP).
    expect(out.outcome).toBe("UP");
    expect(out.voidReason).toBeUndefined();
    expect(out.writeDb).toBe(true);
  });

  it("priority order — pre_release_tick beats no_publish even if maxAge passed", () => {
    // If Pyth is somehow still pre-release (publish_time < release) AND
    // wall-clock has passed the max-age window, the impl should still emit
    // pre_release_tick because that gate is checked first.
    const out = computeEcoOutcome(
      baseCtx,
      tick({ publishTimeSec: RELEASE - 1, priceE8: STRIKE_E8 + 5n }),
      RELEASE + 1801,
    );
    expect(out.voidReason).toBe("pre_release_tick");
    expect(out.writeDb).toBe(false);
  });
});
