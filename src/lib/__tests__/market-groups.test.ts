import { describe, it, expect } from "vitest";
import {
  deriveMarketParams,
  formatUsdFromRaw,
  getTimeZoneOffsetMinutes,
  isMarketOpen,
  MARKET_GROUPS,
  nextNyMidnightUtc,
  renderQuestion,
  THRESHOLD_ABOVE,
  THRESHOLD_BELOW,
  type MarketGroupSpec,
} from "../market-groups";

/** Unix-seconds for a given UTC date string (for readability). */
function utc(iso: string): number {
  return Math.floor(new Date(iso + "Z").getTime() / 1000);
}

const btcSpec: MarketGroupSpec = MARKET_GROUPS["btc-3m"];
const xauUpSpec: MarketGroupSpec = MARKET_GROUPS["xau-daily-up"];
const xauDownSpec: MarketGroupSpec = MARKET_GROUPS["xau-daily-down"];

describe("isMarketOpen", () => {
  it("crypto is always open", () => {
    expect(isMarketOpen(btcSpec, utc("2026-04-25T00:00:00"))).toBe(true);
    expect(isMarketOpen(btcSpec, utc("2026-04-26T02:00:00"))).toBe(true);
    expect(isMarketOpen(btcSpec, utc("2026-04-29T12:00:00"))).toBe(true);
  });

  describe("commodity (XAU) — Sun 22:00 UTC → Fri 21:00 UTC", () => {
    it("is closed all day Saturday", () => {
      expect(isMarketOpen(xauUpSpec, utc("2026-04-25T00:00:00"))).toBe(false);
      expect(isMarketOpen(xauUpSpec, utc("2026-04-25T12:00:00"))).toBe(false);
      expect(isMarketOpen(xauUpSpec, utc("2026-04-25T23:59:00"))).toBe(false);
    });

    it("is closed Sunday before 22:00 UTC", () => {
      expect(isMarketOpen(xauUpSpec, utc("2026-04-26T00:00:00"))).toBe(false);
      expect(isMarketOpen(xauUpSpec, utc("2026-04-26T21:59:00"))).toBe(false);
    });

    it("opens Sunday at 22:00 UTC", () => {
      expect(isMarketOpen(xauUpSpec, utc("2026-04-26T22:00:00"))).toBe(true);
      expect(isMarketOpen(xauUpSpec, utc("2026-04-26T23:30:00"))).toBe(true);
    });

    it("is open Monday–Thursday 24 hours", () => {
      expect(isMarketOpen(xauUpSpec, utc("2026-04-27T00:00:00"))).toBe(true);
      expect(isMarketOpen(xauUpSpec, utc("2026-04-27T12:00:00"))).toBe(true);
      expect(isMarketOpen(xauUpSpec, utc("2026-04-30T23:00:00"))).toBe(true);
    });

    it("closes Friday at 21:00 UTC", () => {
      expect(isMarketOpen(xauUpSpec, utc("2026-05-01T20:59:00"))).toBe(true);
      expect(isMarketOpen(xauUpSpec, utc("2026-05-01T21:00:00"))).toBe(false);
      expect(isMarketOpen(xauUpSpec, utc("2026-05-01T23:30:00"))).toBe(false);
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
  it("BTC/ETH active, XAU up/down active, legacy xau-daily inactive", () => {
    expect(MARKET_GROUPS["btc-3m"]?.active).toBe(true);
    expect(MARKET_GROUPS["eth-3m"]?.active).toBe(true);
    expect(MARKET_GROUPS["xau-daily-up"]?.active).toBe(true);
    expect(MARKET_GROUPS["xau-daily-down"]?.active).toBe(true);
    expect(MARKET_GROUPS["xau-daily"]?.active).toBe(false);
    expect(MARKET_GROUPS["xau-daily"]?.legacyCleanupOnly).toBe(true);
  });

  it("xau-daily-up is commodity with +100 bps ABOVE create_market strategy", () => {
    const up = MARKET_GROUPS["xau-daily-up"];
    expect(up.category).toBe("commodity");
    expect(up.sortName).toBe("XAU ↑");
    expect(up.priceExpo).toBe(-3);
    expect(up.displayTickRaw).toBe(1000n);
    expect(up.resolutionKind).toBe("pyth");
    expect(up.spawnStrategy.kind).toBe("create_market");
    if (up.spawnStrategy.kind !== "create_market") return;
    expect(up.spawnStrategy.strikeOffsetBps).toBe(100);
    expect(up.spawnStrategy.thresholdType).toBe(THRESHOLD_ABOVE);
    expect(up.spawnStrategy.pythExpo).toBe(-3);
    expect(up.spawnStrategy.closeAnchor).toBe("daily-ny-midnight");
  });

  it("xau-daily-down is commodity with -100 bps BELOW create_market strategy", () => {
    const down = MARKET_GROUPS["xau-daily-down"];
    if (down.spawnStrategy.kind !== "create_market") throw new Error();
    expect(down.spawnStrategy.strikeOffsetBps).toBe(-100);
    expect(down.spawnStrategy.thresholdType).toBe(THRESHOLD_BELOW);
  });

  it("BTC/ETH use spawn_recurring_3min strategy", () => {
    expect(MARKET_GROUPS["btc-3m"].spawnStrategy.kind).toBe("spawn_recurring_3min");
    expect(MARKET_GROUPS["eth-3m"].spawnStrategy.kind).toBe("spawn_recurring_3min");
  });
});

describe("formatUsdFromRaw", () => {
  it("formats XAU expo -3 correctly", () => {
    // XAU raw = 4694000 at expo -3 → $4,694.00
    expect(formatUsdFromRaw(4694000n, -3)).toBe("$4,694");
    // Fractional: 4694123 / 1000 = $4,694.123 → 2 frac default, trims trailing zero
    expect(formatUsdFromRaw(4694123n, -3)).toBe("$4,694.12");
    // Exactly $4740 (tick-rounded up)
    expect(formatUsdFromRaw(4740000n, -3)).toBe("$4,740");
  });

  it("formats crypto expo -8 correctly", () => {
    // BTC $78,141 = 78141 * 1e8 = 7814100000000
    expect(formatUsdFromRaw(7814100000000n, -8)).toBe("$78,141");
    // With fractional: 78141.23456 → round to 2 decimals "78,141.23"
    expect(formatUsdFromRaw(7814123456789n, -8)).toBe("$78,141.23");
  });

  it("maximumFractionDigits=0 drops decimals", () => {
    expect(formatUsdFromRaw(4694999n, -3, { maximumFractionDigits: 0 })).toBe(
      "$4,694",
    );
  });
});

describe("getTimeZoneOffsetMinutes for America/New_York", () => {
  it("returns -300 (EST) in January", () => {
    const ms = Date.UTC(2026, 0, 15, 12, 0, 0);
    expect(getTimeZoneOffsetMinutes("America/New_York", ms)).toBe(-300);
  });

  it("returns -240 (EDT) in July", () => {
    const ms = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect(getTimeZoneOffsetMinutes("America/New_York", ms)).toBe(-240);
  });
});

describe("nextNyMidnightUtc", () => {
  it("EDT: April 23 23:00 UTC → April 24 00:00 NY = April 24 04:00 UTC", () => {
    // Apr 23 23:00 UTC = Apr 23 19:00 NY (EDT, UTC-4)
    const input = utc("2026-04-23T23:00:00");
    const got = nextNyMidnightUtc(input);
    expect(got).toBe(utc("2026-04-24T04:00:00"));
  });

  it("EST: January 15 23:00 UTC → January 16 00:00 NY = January 16 05:00 UTC", () => {
    // Jan 15 23:00 UTC = Jan 15 18:00 NY (EST, UTC-5)
    const input = utc("2026-01-15T23:00:00");
    const got = nextNyMidnightUtc(input);
    expect(got).toBe(utc("2026-01-16T05:00:00"));
  });

  it("spring forward: March 8 23:00 UTC (pre-DST) → March 9 00:00 NY = 04:00 UTC (DST already active at midnight)", () => {
    // Spring-forward 2026 happens 2026-03-08 02:00 NY (EST) jumps to 03:00 NY (EDT).
    // So at 2026-03-08 23:00 UTC = 2026-03-08 19:00 NY (EDT, UTC-4 now).
    // "Next NY midnight" is 2026-03-09 00:00 NY = 04:00 UTC (EDT).
    const input = utc("2026-03-08T23:00:00");
    const got = nextNyMidnightUtc(input);
    expect(got).toBe(utc("2026-03-09T04:00:00"));
  });

  it("fall back: November 1 23:00 UTC → November 2 00:00 NY = 05:00 UTC (EST, DST over)", () => {
    // Fall-back 2026 happens 2026-11-01 02:00 NY (EDT) back to 01:00 NY (EST).
    // So by 2026-11-01 23:00 UTC = 2026-11-01 18:00 NY (EST, UTC-5 now).
    // Next NY midnight = 2026-11-02 00:00 NY = 05:00 UTC.
    const input = utc("2026-11-01T23:00:00");
    const got = nextNyMidnightUtc(input);
    expect(got).toBe(utc("2026-11-02T05:00:00"));
  });
});

describe("deriveMarketParams", () => {
  const nowSec = utc("2026-04-23T23:50:00"); // EDT, next NY midnight is 2026-04-24 04:00 UTC

  it("XAU up: +100 bps ABOVE, strike ceil-rounded to $1 tick", () => {
    // priceRaw 4694000 at expo -3 = $4694.00
    // unrounded = 4694000 * 10100 / 10000 = 4740940
    // ceil to tick 1000 = 4741000 = $4741
    const d = deriveMarketParams(xauUpSpec, 4694000n, -3, nowSec);
    expect(d.strikeRaw).toBe(4741000n);
    expect(d.strikeDisplay).toBe(4741);
    expect(d.thresholdType).toBe(THRESHOLD_ABOVE);
    expect(d.closeTime).toBe(utc("2026-04-24T04:00:00"));
    expect(d.question).toBe(
      "Will Gold close above $4,741 at the next New York midnight?",
    );
  });

  it("XAU down: -100 bps BELOW, strike floor-rounded to $1 tick", () => {
    // unrounded = 4694000 * 9900 / 10000 = 4647060
    // floor to tick 1000 = 4647000 = $4647
    const d = deriveMarketParams(xauDownSpec, 4694000n, -3, nowSec);
    expect(d.strikeRaw).toBe(4647000n);
    expect(d.strikeDisplay).toBe(4647);
    expect(d.thresholdType).toBe(THRESHOLD_BELOW);
    expect(d.closeTime).toBe(utc("2026-04-24T04:00:00"));
    expect(d.question).toBe(
      "Will Gold close below $4,647 at the next New York midnight?",
    );
  });

  it("BTC spawn_recurring_3min: strike == open, closeTime = now + 180, no strike template", () => {
    // BTC $78,141.23456789 = 7814123456789 at expo -8
    const btcRaw = 7814123456789n;
    const d = deriveMarketParams(btcSpec, btcRaw, -8, nowSec);
    expect(d.strikeRaw).toBe(btcRaw);
    expect(d.closeTime).toBe(nowSec + 180);
    expect(d.durationSec).toBe(180);
    expect(d.thresholdType).toBe(0);
    expect(d.question).toBe("Will Bitcoin go up in the next 3 minutes?");
  });

  it("throws on expo mismatch", () => {
    expect(() => deriveMarketParams(xauUpSpec, 4694000n, -8, nowSec)).toThrow(
      /expo mismatch/,
    );
  });
});

describe("renderQuestion", () => {
  it("substitutes {strike} at per-spec expo", () => {
    const q = renderQuestion(xauUpSpec, 4741000n, utc("2026-04-24T04:00:00"));
    expect(q).toContain("$4,741");
  });

  it("does not touch templates without placeholders", () => {
    const q = renderQuestion(btcSpec, 7814100000000n, utc("2026-04-23T23:53:00"));
    expect(q).toBe("Will Bitcoin go up in the next 3 minutes?");
  });
});
