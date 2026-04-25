import { describe, it, expect } from "vitest";
import { _computeFromSamples, type VolSample } from "../vol-estimator";
import { ASSET_PARAMS } from "../asset-params";
import { SECONDS_PER_YEAR } from "../barrier-strike";

const BTC_PARAMS = ASSET_PARAMS.BTC;

/**
 * Build N synthetic priceTicksV3 rows with constant `dtSec` spacing whose
 * close-to-close log returns are i.i.d. N(0, σ_step). Returning the e8 form
 * the production query produces.
 */
function syntheticSeries(opts: {
  count: number;
  dtSec: number;
  sigmaPerSample: number;
  seed?: number;
  startPrice?: number;
  startTimeSec?: number;
}): VolSample[] {
  const { count, dtSec, sigmaPerSample } = opts;
  const startPrice = opts.startPrice ?? 100_000;
  const startTime = opts.startTimeSec ?? 1_700_000_000;
  // Box-Muller from a tiny LCG so we don't depend on Math.random determinism
  // across runs.
  let s = opts.seed ?? 12345;
  function rng(): number {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s + 1) / 0x1_0000_0001;
  }
  function gauss(): number {
    const u1 = rng();
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  const out: VolSample[] = [];
  let price = startPrice;
  out.push({
    priceE8: BigInt(Math.round(price * 1e8)),
    publishTimeSec: startTime,
  });
  for (let i = 1; i < count; i++) {
    price = price * Math.exp(sigmaPerSample * gauss());
    out.push({
      priceE8: BigInt(Math.round(price * 1e8)),
      publishTimeSec: startTime + i * dtSec,
    });
  }
  return out;
}

describe("_computeFromSamples — synthetic recovery", () => {
  it("recovers σ_annual within 25% from 200 5-min ticks (target 0.50)", () => {
    const dt = 300; // 5 min
    const targetAnnual = 0.50;
    const sigmaPerStep = targetAnnual / Math.sqrt(SECONDS_PER_YEAR / dt);
    const samples = syntheticSeries({
      count: 200,
      dtSec: dt,
      sigmaPerSample: sigmaPerStep,
      seed: 7,
    });
    const out = _computeFromSamples(samples, "BTC", BTC_PARAMS);
    expect(out.source).toBe("samples");
    expect(out.sampleCount).toBe(199);
    expect(out.sigmaAnnual).toBeGreaterThan(targetAnnual * 0.75);
    expect(out.sigmaAnnual).toBeLessThan(targetAnnual * 1.25);
  });

  it("recovers σ across multiple seeds (averages within 10% of target)", () => {
    const dt = 300;
    const targetAnnual = 0.50;
    const sigmaPerStep = targetAnnual / Math.sqrt(SECONDS_PER_YEAR / dt);
    const samples = [11, 23, 47, 89, 137, 211].map((seed) =>
      _computeFromSamples(
        syntheticSeries({ count: 400, dtSec: dt, sigmaPerSample: sigmaPerStep, seed }),
        "BTC",
        BTC_PARAMS,
      ).sigmaAnnual,
    );
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeGreaterThan(targetAnnual * 0.90);
    expect(mean).toBeLessThan(targetAnnual * 1.10);
  });

  it("isFresh=true when sampleCount ≥ 50", () => {
    const dt = 300;
    const sigmaPerStep = 0.5 / Math.sqrt(SECONDS_PER_YEAR / dt);
    const samples = syntheticSeries({
      count: 60,
      dtSec: dt,
      sigmaPerSample: sigmaPerStep,
      seed: 3,
    });
    const out = _computeFromSamples(samples, "BTC", BTC_PARAMS);
    expect(out.isFresh).toBe(true);
  });

  it("isFresh=false (sample-count half) when 5 ≤ sampleCount < 50", () => {
    const dt = 300;
    const sigmaPerStep = 0.5 / Math.sqrt(SECONDS_PER_YEAR / dt);
    const samples = syntheticSeries({
      count: 10, // → 9 returns < 50 → not fresh
      dtSec: dt,
      sigmaPerSample: sigmaPerStep,
      seed: 5,
    });
    const out = _computeFromSamples(samples, "BTC", BTC_PARAMS);
    expect(out.source).toBe("samples");
    expect(out.isFresh).toBe(false);
  });
});

describe("_computeFromSamples — fallback paths", () => {
  it("returns fallback when samples empty", () => {
    const out = _computeFromSamples([], "BTC", BTC_PARAMS);
    expect(out.source).toBe("fallback");
    expect(out.sigmaAnnual).toBe(BTC_PARAMS.defaultSigmaAnnual);
    expect(out.sampleCount).toBe(0);
    expect(out.isFresh).toBe(false);
  });

  it("returns fallback when fewer than 5 valid returns", () => {
    const samples: VolSample[] = [
      { priceE8: 100_00000000n, publishTimeSec: 100 },
      { priceE8: 101_00000000n, publishTimeSec: 200 },
      { priceE8: 102_00000000n, publishTimeSec: 300 },
      { priceE8: 103_00000000n, publishTimeSec: 400 },
      // 3 returns total → < MIN_SAMPLES=5
    ];
    const out = _computeFromSamples(samples, "BTC", BTC_PARAMS);
    expect(out.source).toBe("fallback");
    expect(out.sigmaAnnual).toBe(BTC_PARAMS.defaultSigmaAnnual);
  });

  it("skips priceE8 ≤ 0 rows", () => {
    const dt = 300;
    const sigmaPerStep = 0.5 / Math.sqrt(SECONDS_PER_YEAR / dt);
    const samples = syntheticSeries({
      count: 100,
      dtSec: dt,
      sigmaPerSample: sigmaPerStep,
      seed: 9,
    });
    // Inject a 0 and a negative.
    samples.splice(50, 0, { priceE8: 0n, publishTimeSec: samples[50].publishTimeSec - 1 });
    samples.splice(60, 0, { priceE8: -1n, publishTimeSec: samples[60].publishTimeSec - 1 });
    const out = _computeFromSamples(samples, "BTC", BTC_PARAMS);
    // Returns count = clean.length-1 (99 left after dropping 2 garbage rows).
    expect(out.source).toBe("samples");
    expect(out.sigmaAnnual).toBeGreaterThan(0);
  });

  it("skips dt=0 (duplicate timestamp) sample pairs", () => {
    const dt = 300;
    const sigmaPerStep = 0.5 / Math.sqrt(SECONDS_PER_YEAR / dt);
    const samples = syntheticSeries({
      count: 100,
      dtSec: dt,
      sigmaPerSample: sigmaPerStep,
      seed: 11,
    });
    // Insert a duplicate timestamp row.
    samples.push({
      priceE8: samples[samples.length - 1].priceE8 * 2n,
      publishTimeSec: samples[samples.length - 1].publishTimeSec, // dup
    });
    const out = _computeFromSamples(samples, "BTC", BTC_PARAMS);
    expect(out.source).toBe("samples");
    // The synthetic 2x jump is ignored because dt=0 — sigmaAnnual stays
    // close to the target 0.5 rather than blowing up.
    expect(out.sigmaAnnual).toBeLessThan(2.0);
  });

  it("sorts unsorted input chronologically before computing", () => {
    const dt = 300;
    const sigmaPerStep = 0.4 / Math.sqrt(SECONDS_PER_YEAR / dt);
    const sorted = syntheticSeries({
      count: 80,
      dtSec: dt,
      sigmaPerSample: sigmaPerStep,
      seed: 13,
    });
    const shuffled = [...sorted].reverse();
    const a = _computeFromSamples(sorted, "BTC", BTC_PARAMS);
    const b = _computeFromSamples(shuffled, "BTC", BTC_PARAMS);
    expect(a.sigmaAnnual).toBeCloseTo(b.sigmaAnnual, 8);
    expect(a.sampleCount).toBe(b.sampleCount);
  });
});
