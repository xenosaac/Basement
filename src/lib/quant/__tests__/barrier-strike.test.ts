import { describe, it, expect } from "vitest";
import { computeBarrierStrike, SECONDS_PER_YEAR } from "../barrier-strike";
import { getAssetParams } from "../asset-params";

const ONE_HOUR = 3600;
const FIFTEEN_MIN = 900;
const ONE_DAY = 86400;

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

  it("default z = 1.28", () => {
    const r = computeBarrierStrike({
      asset: "BTC",
      side: "UP",
      tenorSec: FIFTEEN_MIN,
      P0: 100_000,
      sigmaAnnual: 0.45,
      asOfSec: 0,
    });
    expect(r.z).toBe(1.28);
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

// Per-asset realised-volatility regime sanity checks. Each uses the
// canonical tenor for the group (SOL = 15min, XAU/HYPE/MATIC/APT/XAG/XPT
// = 1h, etc). Bands picked to be slightly wider than the plan §"Verification"
// values so DST / leap-year / floating-point doesn't cause flakiness.
describe("computeBarrierStrike — per-asset realistic strike bands", () => {
  function bandTest(asset: string, tenorSec: number, lowBps: number, highBps: number) {
    const params = getAssetParams(asset);
    const r = computeBarrierStrike({
      asset,
      side: "UP",
      tenorSec,
      P0: 100,
      sigmaAnnual: params.defaultSigmaAnnual,
      asOfSec: 0,
    });
    expect(r.strikeBps, `${asset} ${tenorSec}s strikeBps`).toBeGreaterThanOrEqual(lowBps);
    expect(r.strikeBps, `${asset} ${tenorSec}s strikeBps`).toBeLessThanOrEqual(highBps);
  }

  it("BTC 15min ≈ 30–40 bps", () => bandTest("BTC", FIFTEEN_MIN, 30, 40));
  it("SOL 15min ≈ 55–70 bps", () => bandTest("SOL", FIFTEEN_MIN, 55, 70));
  it("XAU 1h ≈ 12–30 bps", () => bandTest("XAU", ONE_HOUR, 12, 30));
  it("XAG 1h ≈ 30–50 bps", () => bandTest("XAG", ONE_HOUR, 30, 50));
  it("XPT 1h ≈ 25–40 bps", () => bandTest("XPT", ONE_HOUR, 25, 40));
  it("HYPE 1h ≈ 150–220 bps", () => bandTest("HYPE", ONE_HOUR, 150, 220));
  it("MATIC 1h ≈ 120–170 bps", () => bandTest("MATIC", ONE_HOUR, 120, 170));
  it("APT 1h ≈ 130–180 bps", () => bandTest("APT", ONE_HOUR, 130, 180));
});

describe("computeBarrierStrike — clamp behaviour", () => {
  it("clamps to min when σ_tenor is tiny (BTC 3-min, σ raw)", () => {
    // BTC 3min raw X = ~15 bps which is below BTC.minStrikeBps=20.
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
    // BRENT 1d raw X = ~280 bps; max = 80.
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

  it("clamp = 'none' inside the band", () => {
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
