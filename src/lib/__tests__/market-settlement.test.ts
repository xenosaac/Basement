import { describe, it, expect } from "vitest";
import {
  outcomeCodeToLabel,
  settlementDisplayPrices,
} from "../market-settlement";

const fallback = { yesPrice: 0.42, noPrice: 0.58 };

describe("outcomeCodeToLabel", () => {
  it("maps 0 → YES, 1 → NO, 2 → INVALID", () => {
    expect(outcomeCodeToLabel(0)).toBe("YES");
    expect(outcomeCodeToLabel(1)).toBe("NO");
    expect(outcomeCodeToLabel(2)).toBe("INVALID");
  });

  it("treats unknown codes as INVALID", () => {
    expect(outcomeCodeToLabel(255)).toBe("INVALID");
  });
});

describe("settlementDisplayPrices", () => {
  it("returns fallback when state is OPEN or CLOSED regardless of outcome", () => {
    expect(settlementDisplayPrices("OPEN", null, fallback)).toEqual(fallback);
    expect(settlementDisplayPrices("OPEN", "YES", fallback)).toEqual(fallback);
    expect(settlementDisplayPrices("CLOSED", null, fallback)).toEqual(fallback);
    expect(settlementDisplayPrices("CLOSED", "NO", fallback)).toEqual(fallback);
  });

  it("locks to 1.00/0 for RESOLVED + YES", () => {
    expect(settlementDisplayPrices("RESOLVED", "YES", fallback)).toEqual({
      yesPrice: 1,
      noPrice: 0,
    });
  });

  it("locks to 0/1.00 for RESOLVED + NO", () => {
    expect(settlementDisplayPrices("RESOLVED", "NO", fallback)).toEqual({
      yesPrice: 0,
      noPrice: 1,
    });
  });

  it("locks to 0.5/0.5 for RESOLVED + INVALID", () => {
    expect(settlementDisplayPrices("RESOLVED", "INVALID", fallback)).toEqual({
      yesPrice: 0.5,
      noPrice: 0.5,
    });
  });

  it("SETTLED mirrors RESOLVED behaviour", () => {
    expect(settlementDisplayPrices("SETTLED", "YES", fallback)).toEqual({
      yesPrice: 1,
      noPrice: 0,
    });
    expect(settlementDisplayPrices("SETTLED", "NO", fallback)).toEqual({
      yesPrice: 0,
      noPrice: 1,
    });
  });

  it("returns fallback when resolved row has null outcome (grace window)", () => {
    expect(settlementDisplayPrices("RESOLVED", null, fallback)).toEqual(fallback);
    expect(settlementDisplayPrices("SETTLED", null, fallback)).toEqual(fallback);
  });
});
