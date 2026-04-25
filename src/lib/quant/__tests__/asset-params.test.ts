import { describe, it, expect } from "vitest";
import { ASSET_PARAMS, getAssetParams } from "../asset-params";

describe("ASSET_PARAMS table coverage", () => {
  it("contains all v0.5 underlyings", () => {
    const required = [
      "BTC", "ETH", "SOL", "HYPE", "MATIC", "APT",
      "XAU", "XAG", "XPT", "BRENT",
      "QQQ",
      "EUR", "USD", "EURUSD", "USDJPY", "USDCNH",
    ];
    for (const k of required) {
      expect(ASSET_PARAMS[k], `missing ASSET_PARAMS.${k}`).toBeDefined();
    }
  });

  it("min < max for every entry", () => {
    for (const [k, p] of Object.entries(ASSET_PARAMS)) {
      expect(p.minStrikeBps, `${k}.min`).toBeGreaterThan(0);
      expect(p.maxStrikeBps, `${k}.max`).toBeGreaterThan(p.minStrikeBps);
      expect(p.defaultSigmaAnnual, `${k}.σ`).toBeGreaterThan(0);
      expect(p.kFat, `${k}.kFat`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("getAssetParams resolution", () => {
  it("matches a bare uppercase symbol directly", () => {
    expect(getAssetParams("BTC").asset).toBe("BTC");
  });

  it("is case-insensitive", () => {
    expect(getAssetParams("btc").asset).toBe("BTC");
    expect(getAssetParams("Sol").asset).toBe("SOL");
  });

  it("falls back to the prefix before the first dash", () => {
    expect(getAssetParams("btc-usdc-3m").asset).toBe("BTC");
    expect(getAssetParams("sol-15m-strike-up").asset).toBe("SOL");
    expect(getAssetParams("xau-1h-down").asset).toBe("XAU");
    expect(getAssetParams("brent-1d-up").asset).toBe("BRENT");
    expect(getAssetParams("qqq-1d-up").asset).toBe("QQQ");
  });

  it("matches FX pair-form ids directly", () => {
    expect(getAssetParams("eurusd-1h-up").asset).toBe("EURUSD");
    expect(getAssetParams("usdjpy-1h-down").asset).toBe("USDJPY");
    expect(getAssetParams("usdcnh-1h-up").asset).toBe("USDCNH");
  });

  it("throws on unknown asset", () => {
    expect(() => getAssetParams("ZZZ")).toThrow(/unknown/);
    expect(() => getAssetParams("doge-1h")).toThrow(/unknown/);
  });

  it("throws on empty input", () => {
    expect(() => getAssetParams("")).toThrow(/empty/);
  });
});
