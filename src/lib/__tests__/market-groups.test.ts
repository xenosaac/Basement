import { describe, it, expect } from "vitest";
import { isMarketOpen, MARKET_GROUPS, type MarketGroupSpec } from "../market-groups";

/**
 * Helper: Unix-seconds for a given UTC date string (for readability in test cases).
 */
function utc(iso: string): number {
  return Math.floor(new Date(iso + "Z").getTime() / 1000);
}

const btcSpec: MarketGroupSpec = MARKET_GROUPS["btc-3m"];
const xauSpec: MarketGroupSpec = MARKET_GROUPS["xau-daily"];

describe("isMarketOpen", () => {
  it("crypto is always open", () => {
    // Saturday 00:00 UTC — worst case for anything non-crypto
    expect(isMarketOpen(btcSpec, utc("2026-04-25T00:00:00"))).toBe(true);
    // Sunday 02:00 UTC
    expect(isMarketOpen(btcSpec, utc("2026-04-26T02:00:00"))).toBe(true);
    // Mid-week 12:00 UTC
    expect(isMarketOpen(btcSpec, utc("2026-04-29T12:00:00"))).toBe(true);
  });

  describe("commodity (XAU) — Sun 22:00 UTC → Fri 21:00 UTC", () => {
    it("is closed all day Saturday", () => {
      expect(isMarketOpen(xauSpec, utc("2026-04-25T00:00:00"))).toBe(false);
      expect(isMarketOpen(xauSpec, utc("2026-04-25T12:00:00"))).toBe(false);
      expect(isMarketOpen(xauSpec, utc("2026-04-25T23:59:00"))).toBe(false);
    });

    it("is closed Sunday before 22:00 UTC", () => {
      expect(isMarketOpen(xauSpec, utc("2026-04-26T00:00:00"))).toBe(false);
      expect(isMarketOpen(xauSpec, utc("2026-04-26T21:59:00"))).toBe(false);
    });

    it("opens Sunday at 22:00 UTC", () => {
      expect(isMarketOpen(xauSpec, utc("2026-04-26T22:00:00"))).toBe(true);
      expect(isMarketOpen(xauSpec, utc("2026-04-26T23:30:00"))).toBe(true);
    });

    it("is open Monday–Thursday 24 hours", () => {
      expect(isMarketOpen(xauSpec, utc("2026-04-27T00:00:00"))).toBe(true);
      expect(isMarketOpen(xauSpec, utc("2026-04-27T12:00:00"))).toBe(true);
      expect(isMarketOpen(xauSpec, utc("2026-04-30T23:00:00"))).toBe(true);
    });

    it("closes Friday at 21:00 UTC", () => {
      expect(isMarketOpen(xauSpec, utc("2026-05-01T20:59:00"))).toBe(true);
      expect(isMarketOpen(xauSpec, utc("2026-05-01T21:00:00"))).toBe(false);
      expect(isMarketOpen(xauSpec, utc("2026-05-01T23:30:00"))).toBe(false);
    });
  });

  it("stocks category is always closed (Phase 2 will open)", () => {
    const stocksSpec: MarketGroupSpec = {
      ...btcSpec,
      category: "stocks",
      assetSymbol: "AAPL",
    };
    expect(isMarketOpen(stocksSpec, utc("2026-04-29T14:30:00"))).toBe(false);
  });
});

describe("MARKET_GROUPS registry", () => {
  it("has BTC + ETH + XAU all active", () => {
    expect(MARKET_GROUPS["btc-3m"]?.active).toBe(true);
    expect(MARKET_GROUPS["eth-3m"]?.active).toBe(true);
    expect(MARKET_GROUPS["xau-daily"]?.active).toBe(true);
  });

  it("xau-daily is categorized as commodity with 24-hour cadence", () => {
    const xau = MARKET_GROUPS["xau-daily"];
    expect(xau.category).toBe("commodity");
    expect(xau.sortName).toBe("XAU");
    expect(xau.durationSec).toBe(86_400);
    expect(xau.resolutionKind).toBe("pyth");
  });
});
