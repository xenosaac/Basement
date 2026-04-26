import { describe, it, expect } from "vitest";
import {
  computeBarrierStrike,
  defaultZFor,
  DEFAULT_TARGET_TOUCH_PROB,
  inverseNormalCdf,
  SECONDS_PER_YEAR,
} from "../barrier-strike";
import { getAssetParams } from "../asset-params";

const ONE_HOUR = 3600;
const FIFTEEN_MIN = 900;
const ONE_DAY = 86400;
const THREE_MIN = 180;

describe("computeBarrierStrike — basic shape", () => {
  it("UP returns strike > P0; DOWN returns strike < P0", () => {
    const upRes = computeBarrierStrike({
      asset: "BTC",
      side: "UP",
      tenorSec: FIFTEEN_MIN,
      P0: 100_000,
      sigmaAnnual: 0.45,
      asOfSec: 1_700_000_000,
    });
    expect(upRes.strikePrice).toBeGreaterThan(100_000);

    const dn = computeBarrierStrike({
      asset: "BTC",
      side: "DOWN",
      tenorSec: FIFTEEN_MIN,
      P0: 100_000,
      sigmaAnnual: 0.45,
      asOfSec: 1_700_000_000,
    });
    expect(dn.strikePrice).toBeLessThan(100_000);
  });

  it("strikeBps == round(xPercent · 100)", () => {
    const r = computeBarrierStrike({
      asset: "SOL",
      side: "UP",
      tenorSec: FIFTEEN_MIN,
      P0: 150,
      sigmaAnnual: 0.85,
      asOfSec: 1_700_000_000,
    });
    expect(r.strikeBps).toBe(Math.round(r.xPercent * 100));
  });

  it("default z ≈ 0.524 (Φ⁻¹(0.70))", () => {
    const r = computeBarrierStrike({
      asset: "BTC",
      side: "UP",
      tenorSec: FIFTEEN_MIN,
      P0: 100_000,
      sigmaAnnual: 0.45,
      asOfSec: 0,
    });
    expect(r.z).toBeCloseTo(0.5244005, 5);
  });

  it("custom z propagates", () => {
    const r = computeBarrierStrike({
      asset: "BTC",
      side: "UP",
      tenorSec: FIFTEEN_MIN,
      P0: 100_000,
      sigmaAnnual: 0.45,
      asOfSec: 0,
      z: 1.65,
    });
    expect(r.z).toBe(1.65);
  });

  it("kFat reflects asset params", () => {
    const r = computeBarrierStrike({
      asset: "XAU",
      side: "UP",
      tenorSec: ONE_HOUR,
      P0: 2400,
      sigmaAnnual: 0.16,
      asOfSec: 0,
    });
    expect(r.kFat).toBe(1.05);
  });
});

// ─── inverseNormalCdf / defaultZFor unit coverage ────────────────────
describe("inverseNormalCdf", () => {
  it("Φ⁻¹(0.5) = 0", () => {
    expect(inverseNormalCdf(0.5)).toBe(0);
  });

  it("Φ⁻¹(0.975) ≈ 1.95996", () => {
    // Acklam's approximation; 0.0005 absolute tolerance is plenty (relative
    // error of the algorithm is ~1.15e-9 over the open interval).
    expect(inverseNormalCdf(0.975)).toBeCloseTo(1.95996, 4);
    expect(Math.abs(inverseNormalCdf(0.975) - 1.95996)).toBeLessThan(0.0005);
  });

  it("round-trip with hand-computed Φ via Math.erf approximation to 1e-6", () => {
    // Standard Φ(x) = 0.5 · (1 + erf(x / √2)). Node lacks Math.erf in older
    // versions, but the Abramowitz & Stegun 7.1.26 approximation is
    // sufficient (error ≤ 1.5e-7) for round-trip verification.
    const erf = (x: number): number => {
      const a1 = 0.254829592;
      const a2 = -0.284496736;
      const a3 = 1.421413741;
      const a4 = -1.453152027;
      const a5 = 1.061405429;
      const p = 0.3275911;
      const sign = x < 0 ? -1 : 1;
      const ax = Math.abs(x);
      const t = 1.0 / (1.0 + p * ax);
      const y =
        1.0 -
        (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) *
          t *
          Math.exp(-ax * ax);
      return sign * y;
    };
    const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

    for (const target of [0.05, 0.30, 0.50, 0.70, 0.95]) {
      const z = inverseNormalCdf(target);
      // Round-trip Φ(Φ⁻¹(target)) ≈ target. Tolerance set to the looser of
      // (Acklam 1.15e-9, A&S erf 1.5e-7) plus slack → 1e-6.
      expect(Math.abs(phi(z) - target)).toBeLessThan(1e-6);
    }
  });

  it("throws on p ≤ 0 or p ≥ 1", () => {
    expect(() => inverseNormalCdf(0)).toThrow();
    expect(() => inverseNormalCdf(1)).toThrow();
    expect(() => inverseNormalCdf(-0.1)).toThrow();
    expect(() => inverseNormalCdf(1.5)).toThrow();
  });
});

describe("defaultZFor", () => {
  it("defaultZFor(0.30) ≈ 0.524 ± 0.005", () => {
    const z = defaultZFor(0.30);
    expect(Math.abs(z - 0.524)).toBeLessThan(0.005);
  });

  it("defaultZFor(0.50) = 0", () => {
    expect(defaultZFor(0.50)).toBe(0);
  });

  it("DEFAULT_TARGET_TOUCH_PROB is 0.30", () => {
    expect(DEFAULT_TARGET_TOUCH_PROB).toBe(0.30);
  });
});

// ─── Per active asset realistic strike bands ─────────────────────────
//
// Bands are derived analytically from the formula
//   xRawBps = z · σ · √(tenor / SECONDS_PER_YEAR) · kFat · 1e4
// with z = defaultZFor(0.30) ≈ 0.5244, then clamp to [min,max]Bps.
// Tolerance ±0.5bps (rounding via Math.round in computeBarrierStrike).
//
// Active pairs (per /Users/isaaczhang/.claude/plans/image-5-can-we-glittery-pebble.md):
//   BTC   3-min   →  6.20bps  → clamp min   → 20  ✓
//   ETH   3-min   →  8.96bps  → clamp min   → 30  ✓
//   SOL   15-min  → 26.19bps  → no clamp    → 26  ✓ (post-min reduction)
//   HYPE  1-hour  → 73.96bps  → no clamp    → 74  ✓
//   XAU   1-hour  →  9.41bps  → no clamp    →  9  ✓
//   XAG   1-hour  → 16.47bps  → no clamp    → 16  ✓
//   QQQ   1-day   → 60.39bps  → clamp max   → 60  ✓
//   NVDA  1-day   →135.87bps  → clamp max   →100  ✓
describe("computeBarrierStrike — per-active-asset bands at default z", () => {
  function check(
    asset: string,
    tenorSec: number,
    expectedBps: number,
    expectedClamp: "min" | "max" | "none",
  ) {
    const params = getAssetParams(asset);
    const r = computeBarrierStrike({
      asset,
      side: "UP",
      tenorSec,
      P0: 100,
      sigmaAnnual: params.defaultSigmaAnnual,
      asOfSec: 0,
    });
    expect(
      r.strikeBps,
      `${asset} ${tenorSec}s strikeBps`,
    ).toBeGreaterThanOrEqual(expectedBps - 1);
    expect(
      r.strikeBps,
      `${asset} ${tenorSec}s strikeBps`,
    ).toBeLessThanOrEqual(expectedBps + 1);
    expect(r.clamp, `${asset} ${tenorSec}s clamp`).toBe(expectedClamp);
  }

  it("BTC 3-min ≈ 20 bps (min-clamped)", () =>
    check("BTC", THREE_MIN, 20, "min"));
  it("ETH 3-min ≈ 30 bps (min-clamped)", () =>
    check("ETH", THREE_MIN, 30, "min"));
  it("SOL 15-min ≈ 26 bps (no clamp, post-min-reduction)", () =>
    check("SOL", FIFTEEN_MIN, 26, "none"));
  it("HYPE 1-hour ≈ 74 bps (no clamp)", () =>
    check("HYPE", ONE_HOUR, 74, "none"));
  it("XAU 1-hour ≈ 9 bps (no clamp)", () =>
    check("XAU", ONE_HOUR, 9, "none"));
  it("XAG 1-hour ≈ 16 bps (no clamp)", () =>
    check("XAG", ONE_HOUR, 16, "none"));
  it("QQQ 1-day ≈ 60 bps (max-clamped)", () =>
    check("QQQ", ONE_DAY, 60, "max"));
  it("NVDA 1-day ≈ 100 bps (max-clamped)", () =>
    check("NVDA", ONE_DAY, 100, "max"));

  it("xPercent = strikeBps/100 across all active pairs", () => {
    const cases: Array<[string, number]> = [
      ["BTC", THREE_MIN],
      ["ETH", THREE_MIN],
      ["SOL", FIFTEEN_MIN],
      ["HYPE", ONE_HOUR],
      ["XAU", ONE_HOUR],
      ["XAG", ONE_HOUR],
      ["QQQ", ONE_DAY],
      ["NVDA", ONE_DAY],
    ];
    for (const [asset, tenor] of cases) {
      const params = getAssetParams(asset);
      const r = computeBarrierStrike({
        asset,
        side: "UP",
        tenorSec: tenor,
        P0: 100,
        sigmaAnnual: params.defaultSigmaAnnual,
        asOfSec: 0,
      });
      expect(r.strikeBps).toBe(Math.round(r.xPercent * 100));
    }
  });
});

// ─── Per-asset targetTouchProb override ─────────────────────────────
describe("computeBarrierStrike — params.targetTouchProb override", () => {
  it("default 0.30 yields z ≈ 0.524", () => {
    const r = computeBarrierStrike({
      asset: "BTC",
      side: "UP",
      tenorSec: FIFTEEN_MIN,
      P0: 100_000,
      sigmaAnnual: 0.45,
      asOfSec: 0,
    });
    expect(r.z).toBeCloseTo(defaultZFor(0.30), 6);
  });

  it("explicit z input still wins over targetTouchProb", () => {
    const r = computeBarrierStrike({
      asset: "BTC",
      side: "UP",
      tenorSec: FIFTEEN_MIN,
      P0: 100_000,
      sigmaAnnual: 0.45,
      asOfSec: 0,
      z: 2.0,
    });
    expect(r.z).toBe(2.0);
  });
});

describe("computeBarrierStrike — clamp behaviour", () => {
  it("clamps to min when σ_tenor is tiny (BTC 3-min, σ raw)", () => {
    // BTC 3min raw X = ~6 bps which is below BTC.minStrikeBps=20.
    const r = computeBarrierStrike({
      asset: "BTC",
      side: "UP",
      tenorSec: 180,
      P0: 100_000,
      sigmaAnnual: 0.45,
      asOfSec: 0,
    });
    expect(r.clamp).toBe("min");
    expect(r.strikeBps).toBe(20);
  });

  it("clamps to max when σ_tenor is huge (BRENT daily)", () => {
    // BRENT 1d raw X = ~115 bps; max = 80.
    const r = computeBarrierStrike({
      asset: "BRENT",
      side: "UP",
      tenorSec: ONE_DAY,
      P0: 80,
      sigmaAnnual: 0.40,
      asOfSec: 0,
    });
    expect(r.clamp).toBe("max");
    expect(r.strikeBps).toBe(80);
  });

  it("clamp = 'none' inside the band (SOL 15-min, post-min-reduction)", () => {
    const r = computeBarrierStrike({
      asset: "SOL",
      side: "UP",
      tenorSec: FIFTEEN_MIN,
      P0: 150,
      sigmaAnnual: 0.85,
      asOfSec: 0,
    });
    expect(r.clamp).toBe("none");
  });

  it("UP clamp gives strike = P0·(1 + maxX)", () => {
    const params = getAssetParams("BRENT");
    const r = computeBarrierStrike({
      asset: "BRENT",
      side: "UP",
      tenorSec: ONE_DAY,
      P0: 80,
      sigmaAnnual: 0.40,
      asOfSec: 0,
    });
    const expected = 80 * (1 + params.maxStrikeBps / 10_000);
    expect(r.strikePrice).toBeCloseTo(expected, 6);
  });

  it("DOWN clamp gives strike = P0·(1 − minX)", () => {
    const params = getAssetParams("BTC");
    const r = computeBarrierStrike({
      asset: "BTC",
      side: "DOWN",
      tenorSec: 180,
      P0: 100_000,
      sigmaAnnual: 0.45,
      asOfSec: 0,
    });
    const expected = 100_000 * (1 - params.minStrikeBps / 10_000);
    expect(r.strikePrice).toBeCloseTo(expected, 6);
  });
});

describe("computeBarrierStrike — input validation", () => {
  it("throws on tenorSec ≤ 0", () => {
    expect(() =>
      computeBarrierStrike({
        asset: "BTC",
        side: "UP",
        tenorSec: 0,
        P0: 100,
        sigmaAnnual: 0.45,
        asOfSec: 0,
      }),
    ).toThrow();
  });

  it("throws on P0 ≤ 0", () => {
    expect(() =>
      computeBarrierStrike({
        asset: "BTC",
        side: "UP",
        tenorSec: 900,
        P0: 0,
        sigmaAnnual: 0.45,
        asOfSec: 0,
      }),
    ).toThrow();
  });

  it("throws on sigmaAnnual ≤ 0", () => {
    expect(() =>
      computeBarrierStrike({
        asset: "BTC",
        side: "UP",
        tenorSec: 900,
        P0: 100,
        sigmaAnnual: 0,
        asOfSec: 0,
      }),
    ).toThrow();
  });
});

describe("SECONDS_PER_YEAR constant", () => {
  it("equals 365 × 86400", () => {
    expect(SECONDS_PER_YEAR).toBe(365 * 86400);
  });
});
