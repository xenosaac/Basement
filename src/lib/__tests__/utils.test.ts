import { describe, expect, it } from "vitest";
import { renderSeriesQuestion } from "../utils";

// Note: formatStrikeFromE8 is private. We exercise it through renderSeriesQuestion's
// "absolute_above" / "absolute_below" branches.

describe("renderSeriesQuestion strike formatting", () => {
  it("formats XAU at expo -3 correctly", () => {
    const q = renderSeriesQuestion({
      pair: "XAU/USDC",
      cadenceSec: 3600,
      strikeKind: "absolute_above",
      strikePriceE8: 4709161n,
      priceExpo: -3,
    });
    expect(q).toContain("$4,709.16");
    expect(q).not.toContain("$0.05");
    expect(q).not.toContain("NaN");
  });

  it("formats QQQ at expo -5 correctly", () => {
    const q = renderSeriesQuestion({
      pair: "QQQ/USDC",
      cadenceSec: 86400,
      strikeKind: "absolute_below",
      strikePriceE8: 48075000n,
      priceExpo: -5,
    });
    expect(q).toContain("$480.75");
  });

  it("formats BTC at expo -8 correctly", () => {
    const q = renderSeriesQuestion({
      pair: "BTC/USDC",
      cadenceSec: 180,
      strikeKind: "absolute_above",
      strikePriceE8: 7749579000000n,
      priceExpo: -8,
    });
    expect(q).toContain("$77,495.79");
  });

  it("falls back to dynamic-level copy when strikePriceE8 is null", () => {
    const q = renderSeriesQuestion({
      pair: "HYPE/USDC",
      cadenceSec: 3600,
      strikeKind: "absolute_above",
      strikePriceE8: null,
      priceExpo: -8,
    });
    expect(q).toContain("dynamic level");
    expect(q).not.toContain("$NaN");
    expect(q).not.toContain("$null");
  });

  it("preserves rise_fall copy untouched", () => {
    const q = renderSeriesQuestion({
      pair: "BTC/USDC",
      cadenceSec: 180,
      strikeKind: "rise_fall",
    });
    expect(q).toBe("Will BTC rise in the next 3-min?");
  });

  it("preserves rise_fall when strikeKind omitted", () => {
    const q = renderSeriesQuestion({
      pair: "ETH/USDC",
      cadenceSec: 180,
    });
    expect(q).toContain("rise");
  });

  it("renders zero strike as $0 (boundary)", () => {
    const q = renderSeriesQuestion({
      pair: "BTC/USDC",
      cadenceSec: 180,
      strikeKind: "absolute_above",
      strikePriceE8: 0n,
      priceExpo: -8,
    });
    expect(q).toContain("$0");
  });
});
