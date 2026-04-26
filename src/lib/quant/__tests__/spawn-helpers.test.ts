/**
 * Unit tests for `computeSpawnShadow` (Phase F-2).
 *
 * Covers the four strikeKind branches + error paths. Vol-estimator is mocked
 * so tests are deterministic; we exercise the helper's branching logic and
 * the strike-raw arithmetic against real `MARKET_GROUPS` registry entries.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock vol-estimator BEFORE importing the helper. We pin σ to a known value
// so the strike computation is fully deterministic — the math is already
// covered by `barrier-strike.test.ts`; here we verify wiring.
vi.mock("@/lib/quant/vol-estimator", () => ({
  computeRealizedVol7d: vi.fn(async () => ({
    sigmaAnnual: 0.16, // matches XAU defaultSigmaAnnual for stable expectations
    sampleCount: 120,
    lastSampleSec: 1_700_000_000,
    isFresh: true,
    source: "samples" as const,
  })),
}));

import { computeSpawnShadow } from "../spawn-helpers";
import { computeRealizedVol7d } from "../vol-estimator";

const NOW = 1_700_000_000; // arbitrary fixed clock; not at any anchor boundary

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeSpawnShadow — rise_fall (legacy strategies)", () => {
  it("btc-3m returns rise_fall shadow with strike == livePrice", async () => {
    const livePriceRaw = 7_749_017_250_000n; // BTC at $77,490.17 (expo -8)
    const shadow = await computeSpawnShadow({
      groupId: "btc-3m",
      livePriceRaw,
      nowUtcSec: NOW,
    });
    expect(shadow.strikeKind).toBe("rise_fall");
    expect(shadow.strikePriceE8).toBe(livePriceRaw);
    expect(shadow.barrierLowPriceE8).toBeNull();
    expect(shadow.barrierHighPriceE8).toBeNull();
    expect(shadow.volSourceTag).toBe("rise_fall");
    expect(shadow.volIsFresh).toBe(false);
    // rise_fall must NOT consult the vol estimator (saves DB query for
    // every BTC/ETH 3-min lazy spawn).
    expect(computeRealizedVol7d).not.toHaveBeenCalled();
  });

  it("eth-3m returns rise_fall shadow", async () => {
    const livePriceRaw = 231_353_867_384n;
    const shadow = await computeSpawnShadow({
      groupId: "eth-3m",
      livePriceRaw,
      nowUtcSec: NOW,
    });
    expect(shadow.strikeKind).toBe("rise_fall");
    expect(shadow.strikePriceE8).toBe(livePriceRaw);
  });

  it("legacy create_market group (xau-daily-up) treated as rise_fall", async () => {
    // xau-daily-up uses `kind: "create_market"` (not dynamic_strike) — the
    // helper's contract: anything that isn't `create_market_dynamic_strike`
    // collapses to rise_fall shadow. Fine for this group since it's
    // legacyCleanupOnly anyway.
    const shadow = await computeSpawnShadow({
      groupId: "xau-daily-up",
      livePriceRaw: 4_709_161n,
      nowUtcSec: NOW,
    });
    expect(shadow.strikeKind).toBe("rise_fall");
  });
});

describe("computeSpawnShadow — absolute_above", () => {
  it("xau-1h-up returns barrierHigh > livePrice, barrierLow null", async () => {
    // Plan sanity check: livePriceRaw 4_709_161 (interpreted via spec.priceExpo)
    // → expect a barrierHigh slightly above, barrierLow null.
    const livePriceRaw = 4_709_161n;
    const shadow = await computeSpawnShadow({
      groupId: "xau-1h-up",
      livePriceRaw,
      nowUtcSec: NOW,
    });
    expect(shadow.strikeKind).toBe("absolute_above");
    expect(shadow.barrierLowPriceE8).toBeNull();
    expect(shadow.barrierHighPriceE8).not.toBeNull();
    // Strike is positive offset from spot; raw integers compare directly.
    expect(shadow.barrierHighPriceE8!).toBeGreaterThan(livePriceRaw);
    // strikePriceE8 mirrors the active barrier for chain parity.
    expect(shadow.strikePriceE8).toBe(shadow.barrierHighPriceE8);
    expect(shadow.volSourceTag).toBe("samples");
    expect(shadow.volIsFresh).toBe(true);
    expect(computeRealizedVol7d).toHaveBeenCalledWith("xau-1h-up", NOW);
  });

  it("hype-1h-up produces a strike strictly greater than spot", async () => {
    const livePriceRaw = 4_126_063_410n;
    const shadow = await computeSpawnShadow({
      groupId: "hype-1h-up",
      livePriceRaw,
      nowUtcSec: NOW,
    });
    expect(shadow.strikeKind).toBe("absolute_above");
    expect(shadow.barrierHighPriceE8!).toBeGreaterThan(livePriceRaw);
    expect(shadow.barrierLowPriceE8).toBeNull();
  });
});

describe("computeSpawnShadow — absolute_below", () => {
  it("qqq-1d-down returns barrierLow < livePrice, barrierHigh null", async () => {
    const livePriceRaw = 48_075_000n; // QQQ ~$480.75 (expo -5)
    const shadow = await computeSpawnShadow({
      groupId: "qqq-1d-down",
      livePriceRaw,
      nowUtcSec: NOW,
    });
    expect(shadow.strikeKind).toBe("absolute_below");
    expect(shadow.barrierHighPriceE8).toBeNull();
    expect(shadow.barrierLowPriceE8).not.toBeNull();
    expect(shadow.barrierLowPriceE8!).toBeLessThan(livePriceRaw);
    // Below path: strikePriceE8 mirrors barrierLow for chain-display parity.
    expect(shadow.strikePriceE8).toBe(shadow.barrierLowPriceE8);
  });

  it("nvda-1d-down produces strike below spot", async () => {
    const livePriceRaw = 13_500_000n; // NVDA ~$135 (expo -5)
    const shadow = await computeSpawnShadow({
      groupId: "nvda-1d-down",
      livePriceRaw,
      nowUtcSec: NOW,
    });
    expect(shadow.strikeKind).toBe("absolute_below");
    expect(shadow.barrierLowPriceE8!).toBeLessThan(livePriceRaw);
    expect(shadow.barrierHighPriceE8).toBeNull();
  });
});

describe("computeSpawnShadow — barrier_two_sided", () => {
  it("sol-15m-barrier returns both barriers; low < spot < high", async () => {
    // sol-15m-barrier is registered with active:false but still in the
    // registry — helper returns shadow regardless of active flag because
    // active filtering is the cron's concern, not the quant helper's.
    const livePriceRaw = 8_608_260_634n; // SOL ~$86.08 (expo -8)
    const shadow = await computeSpawnShadow({
      groupId: "sol-15m-barrier",
      livePriceRaw,
      nowUtcSec: NOW,
    });
    expect(shadow.strikeKind).toBe("barrier_two_sided");
    expect(shadow.barrierLowPriceE8).not.toBeNull();
    expect(shadow.barrierHighPriceE8).not.toBeNull();
    expect(shadow.barrierLowPriceE8!).toBeLessThan(livePriceRaw);
    expect(shadow.barrierHighPriceE8!).toBeGreaterThan(livePriceRaw);
    // Chain-display parity: strikePriceE8 = upper barrier.
    expect(shadow.strikePriceE8).toBe(shadow.barrierHighPriceE8);
  });
});

describe("computeSpawnShadow — error paths", () => {
  it("throws on unknown groupId (no silent fallback)", async () => {
    await expect(
      computeSpawnShadow({
        groupId: "made-up-group",
        livePriceRaw: 100n,
        nowUtcSec: NOW,
      }),
    ).rejects.toThrow(/unknown groupId/);
  });

  it("throws on non-positive livePriceRaw", async () => {
    await expect(
      computeSpawnShadow({
        groupId: "btc-3m",
        livePriceRaw: 0n,
        nowUtcSec: NOW,
      }),
    ).rejects.toThrow(/non-positive livePriceRaw/);
  });
});

describe("computeSpawnShadow — XAU sanity check (plan reference value)", () => {
  it("xau-1h-up at livePriceRaw=4709161 produces a barrier offset ~0.01–0.5%", async () => {
    // Plan F-2 sanity: σ=0.16 (XAU default) · √(3600/31536000) · k_fat 1.05
    //   σ_tenor ≈ 0.16 · 0.01069 ≈ 0.001710
    //   z ≈ 0.524 → x_raw ≈ 0.524 · 0.001710 · 1.05 ≈ 0.000941 (~9.4 bps)
    //   But XAU minStrikeBps=8 — the clamp doesn't kick in.
    //   x final ≈ 0.000941 (94 bps not relevant; raw in fractional form)
    //   ~0.094% offset; small but nonzero.
    // Note: tenor depends on `nowUtcSec` distance to next top-of-hour. NOW
    // (1_700_000_000) → next top-of-hour at 1_700_001_200 = +1200s tenor.
    const livePriceRaw = 4_709_161n;
    const shadow = await computeSpawnShadow({
      groupId: "xau-1h-up",
      livePriceRaw,
      nowUtcSec: NOW,
    });
    // Sanity: strike > spot but within 1% (XAU is tight).
    const offset = Number(shadow.barrierHighPriceE8! - livePriceRaw) / Number(livePriceRaw);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(0.01); // <1% offset for XAU 1h
    // Print the absolute strike value to make manual verification easy in
    // CI logs. (vitest captures console.log on failure.)
    console.log(
      `[XAU sanity] livePriceRaw=${livePriceRaw} barrierHigh=${shadow.barrierHighPriceE8} ` +
        `offsetPct=${(offset * 100).toFixed(4)}%`,
    );
  });
});
