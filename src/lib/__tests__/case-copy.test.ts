import { describe, expect, it } from "vitest";
import {
  categoryFromPrefix,
  formatBarrierPriceFromE8,
  getCaseHeadline,
  parseCase,
} from "../case-copy";

describe("parseCase", () => {
  it("parses sol-15m-strike-up", () => {
    expect(parseCase("sol-15m-strike-up")).toEqual({
      asset: "SOL",
      tenor: "15m",
      strikeKind: "up",
    });
  });

  it("parses sol-15m-strike-down", () => {
    expect(parseCase("sol-15m-strike-down")).toEqual({
      asset: "SOL",
      tenor: "15m",
      strikeKind: "down",
    });
  });

  it("parses sol-15m-barrier", () => {
    expect(parseCase("sol-15m-barrier")).toEqual({
      asset: "SOL",
      tenor: "15m",
      strikeKind: "barrier",
    });
  });

  it("parses xau-1h-up + xau-1h-down", () => {
    expect(parseCase("xau-1h-up")).toEqual({
      asset: "XAU",
      tenor: "1h",
      strikeKind: "up",
    });
    expect(parseCase("xau-1h-down")).toEqual({
      asset: "XAU",
      tenor: "1h",
      strikeKind: "down",
    });
  });

  it("parses qqq-1d-* with NY 4pm anchor", () => {
    expect(parseCase("qqq-1d-up")?.tenor).toBe("1d-4pm");
    expect(parseCase("qqq-1d-down")?.tenor).toBe("1d-4pm");
  });

  it("parses brent-1d-* with NY noon anchor", () => {
    expect(parseCase("brent-1d-up")?.tenor).toBe("1d-noon");
    expect(parseCase("brent-1d-down")?.tenor).toBe("1d-noon");
  });

  it("parses forex 1h pairs preserving fused asset symbol", () => {
    expect(parseCase("eurusd-1h-up")).toEqual({
      asset: "EURUSD",
      tenor: "1h",
      strikeKind: "up",
    });
    expect(parseCase("usdjpy-1h-down")).toEqual({
      asset: "USDJPY",
      tenor: "1h",
      strikeKind: "down",
    });
    expect(parseCase("usdcnh-1h-up")?.asset).toBe("USDCNH");
  });

  it("returns null for legacy btc-3m / eth-3m so the registry question wins", () => {
    // The 3-min flagship rounds have hand-tuned questionTemplates ("Will
    // Bitcoin go up in the next 3 minutes?") — no synthesised headline can
    // match that polish, so we deliberately don't parse them.
    expect(parseCase("btc-3m")).toBeNull();
    expect(parseCase("eth-3m")).toBeNull();
  });

  it("returns null for ECO group ids (handled separately)", () => {
    expect(parseCase("eco-cpi-mom-monthly")).toBeNull();
    expect(parseCase("eco-core-pce-monthly")).toBeNull();
    expect(parseCase("eco-unemployment-monthly")).toBeNull();
    expect(parseCase("eco-gdp-qoq-quarterly")).toBeNull();
  });

  it("returns null for null / empty / unrecognised", () => {
    expect(parseCase(null)).toBeNull();
    expect(parseCase(undefined)).toBeNull();
    expect(parseCase("")).toBeNull();
    expect(parseCase("legacy-mirror-market")).toBeNull();
    expect(parseCase("xau-daily")).toBeNull(); // legacy id, no tenor match
  });
});

describe("categoryFromPrefix", () => {
  it("commodity prefixes", () => {
    expect(categoryFromPrefix("xau-1h-up")).toBe("commodity");
    expect(categoryFromPrefix("xag-1h-down")).toBe("commodity");
    expect(categoryFromPrefix("xpt-1h-up")).toBe("commodity");
    expect(categoryFromPrefix("brent-1d-down")).toBe("commodity");
  });

  it("crypto prefixes", () => {
    expect(categoryFromPrefix("btc-3m")).toBe("crypto");
    expect(categoryFromPrefix("eth-3m")).toBe("crypto");
    expect(categoryFromPrefix("sol-15m-barrier")).toBe("crypto");
    expect(categoryFromPrefix("hype-1h-up")).toBe("crypto");
    expect(categoryFromPrefix("matic-1h-down")).toBe("crypto");
    expect(categoryFromPrefix("apt-1h-up")).toBe("crypto");
  });

  it("stocks prefix", () => {
    expect(categoryFromPrefix("qqq-1d-up")).toBe("stocks");
    expect(categoryFromPrefix("qqq-1d-down")).toBe("stocks");
  });

  it("forex → others", () => {
    expect(categoryFromPrefix("eurusd-1h-up")).toBe("others");
    expect(categoryFromPrefix("usdjpy-1h-down")).toBe("others");
    expect(categoryFromPrefix("usdcnh-1h-up")).toBe("others");
  });

  it("eco → macro", () => {
    expect(categoryFromPrefix("eco-cpi-mom-monthly")).toBe("macro");
    expect(categoryFromPrefix("eco-gdp-qoq-quarterly")).toBe("macro");
  });

  it("unknown / null → others", () => {
    expect(categoryFromPrefix(null)).toBe("others");
    expect(categoryFromPrefix(undefined)).toBe("others");
    expect(categoryFromPrefix("")).toBe("others");
    expect(categoryFromPrefix("totally-new-thing")).toBe("others");
  });
});

describe("getCaseHeadline", () => {
  it("renders barrier headlines with absolute price range", () => {
    expect(
      getCaseHeadline({
        recurringGroupId: "sol-15m-barrier",
        question: "fallback question",
        // 147.43 USD = 14743000000 e8 units
        barrierLowPriceE8: 14_743_000_000n,
        // 149.21 USD = 14921000000 e8
        barrierHighPriceE8: 14_921_000_000n,
      }),
    ).toBe("Will SOL break out of $147.43 – $149.21 in next 15 minutes?");
  });

  it("renders 'break above' for strike-up", () => {
    expect(
      getCaseHeadline({
        recurringGroupId: "xau-1h-up",
        question: "fallback",
        strikePrice: 2412.5,
      }),
    ).toBe("Will XAU break above $2,412.50 in next 1 hour?");
  });

  it("renders 'break below' for strike-down", () => {
    expect(
      getCaseHeadline({
        recurringGroupId: "xau-1h-down",
        question: "fallback",
        strikePrice: "2380.10",
      }),
    ).toBe("Will XAU break below $2,380.10 in next 1 hour?");
  });

  it("uses NASDAQ100 alias for QQQ + 4pm tenor", () => {
    expect(
      getCaseHeadline({
        recurringGroupId: "qqq-1d-up",
        question: "fallback",
        strikePrice: 502.34,
      }),
    ).toBe("Will NASDAQ100 break above $502.34 in by NY 4:00 PM ET close?");
  });

  it("uses 'EUR/USD' formatting for forex pair", () => {
    expect(
      getCaseHeadline({
        recurringGroupId: "eurusd-1h-up",
        question: "fallback",
        strikePrice: 1.0875,
      }),
    ).toContain("EUR/USD");
  });

  it("falls back to market.question when groupId is null", () => {
    expect(
      getCaseHeadline({
        recurringGroupId: null,
        question: "Will the price go up?",
        strikePrice: 100,
      }),
    ).toBe("Will the price go up?");
  });

  it("falls back to market.question when barrier prices missing on barrier card", () => {
    expect(
      getCaseHeadline({
        recurringGroupId: "sol-15m-barrier",
        question: "Custom barrier question",
        barrierLowPriceE8: null,
        barrierHighPriceE8: null,
      }),
    ).toBe("Custom barrier question");
  });

  it("falls back to market.question when strike missing on directional card", () => {
    expect(
      getCaseHeadline({
        recurringGroupId: "xau-1h-up",
        question: "Custom XAU question",
        strikePrice: null,
      }),
    ).toBe("Custom XAU question");
  });

  it("falls back for ECO group ids until v1 wires the template", () => {
    expect(
      getCaseHeadline({
        recurringGroupId: "eco-cpi-mom-monthly",
        question: "Will US CPI MoM exceed 0.30%?",
      }),
    ).toBe("Will US CPI MoM exceed 0.30%?");
  });
});

describe("formatBarrierPriceFromE8", () => {
  it("formats whole + fractional prices to 2dp", () => {
    expect(formatBarrierPriceFromE8(14_743_000_000n)).toBe("$147.43");
    expect(formatBarrierPriceFromE8(100_000_000n)).toBe("$1.00");
    expect(formatBarrierPriceFromE8(0n)).toBe("$0.00");
  });

  it("accepts string input", () => {
    expect(formatBarrierPriceFromE8("14921000000")).toBe("$149.21");
  });

  it("rounds half up at the cent boundary", () => {
    // 1.235 USD = 123_500_000 e8 → cents 23.5 → rounds to 24.
    expect(formatBarrierPriceFromE8(123_500_000n)).toBe("$1.24");
  });

  it("renders thousands separators on large prices", () => {
    // 65,432.10 USD = 6_543_210_000_000 e8.
    expect(formatBarrierPriceFromE8(6_543_210_000_000n)).toBe("$65,432.10");
  });

  it("returns $— on null / unparseable input", () => {
    expect(formatBarrierPriceFromE8(null)).toBe("$—");
    expect(formatBarrierPriceFromE8(undefined)).toBe("$—");
    expect(formatBarrierPriceFromE8("not-a-number")).toBe("$—");
  });
});
