import { describe, it, expect } from "vitest";
import {
  impliedProbability,
  formatCentsShare,
  formatPercent,
  formatUsdFromCents,
  v3SettlementDisplay,
  strikeVsLive,
  sparklineVariantFor,
  isSeriesResolving,
  V3_SETTLEMENT_EPSILON_CENTS,
  curvePrices,
  quoteBuy,
  quoteSell,
} from "../v3-pricing";

describe("impliedProbability", () => {
  it("zero-total pool returns 50/50 with zeroTotal flag", () => {
    const p = impliedProbability(0n, 0n);
    expect(p.upCents).toBe(50);
    expect(p.downCents).toBe(50);
    expect(p.upPct).toBe(50);
    expect(p.downPct).toBe(50);
    expect(p.zeroTotal).toBe(true);
    expect(p.oneSided).toBe(false);
  });

  it("only UP stake returns 99/1 oneSided", () => {
    const p = impliedProbability(10_000n, 0n);
    expect(p.upCents).toBe(99);
    expect(p.downCents).toBe(1);
    expect(p.oneSided).toBe(true);
    expect(p.zeroTotal).toBe(false);
    expect(p.upPct + p.downPct).toBe(100);
  });

  it("only DOWN stake returns 1/99 oneSided", () => {
    const p = impliedProbability(0n, 10_000n);
    expect(p.upCents).toBe(1);
    expect(p.downCents).toBe(99);
    expect(p.oneSided).toBe(true);
    expect(p.zeroTotal).toBe(false);
    expect(p.upPct + p.downPct).toBe(100);
  });

  it("50/50 pool returns 50¢/50¢", () => {
    const p = impliedProbability(5_000n, 5_000n);
    expect(p.upCents).toBe(50);
    expect(p.downCents).toBe(50);
    expect(p.oneSided).toBe(false);
    expect(p.zeroTotal).toBe(false);
  });

  it("30%-UP pool returns 30¢/70¢ (crowd-certainty)", () => {
    // Crowd-certainty: upCents mirrors the UP stake fraction. With 3k on UP
    // and 7k on DOWN (30% UP), the market believes DOWN is more likely so
    // UP shares are cheap (30¢) and DOWN expensive (70¢).
    //
    // NOTE: the task brief mislabeled this as "70%-UP → 30/70 (parimutuel
    // inversion)" but that interpretation contradicts tests 2/3/6 in the
    // same brief (only-UP → 99/1, 99.6%-UP → 99/1). The consistent reading
    // is crowd-certainty per Polymarket display conventions; see
    // v3-pricing.ts docstring.
    const p = impliedProbability(3_000n, 7_000n);
    expect(p.upCents).toBe(30);
    expect(p.downCents).toBe(70);
    expect(p.upPct + p.downPct).toBe(100);
  });

  it("extreme 99.6%-UP clamps to 99¢/1¢ during LIVE", () => {
    const p = impliedProbability(996_000n, 4_000n);
    expect(p.upCents).toBe(99);
    expect(p.downCents).toBe(1);
    expect(p.oneSided).toBe(false);
  });

  it("bigint-safe with 10^15 cents pools (no precision loss)", () => {
    // 10^15 cents = $10 trillion. Well past Number.MAX_SAFE_INTEGER.
    // Crowd-certainty: 30% UP stake → upCents=30.
    const up = 300_000_000_000_000n;
    const down = 700_000_000_000_000n;
    const p = impliedProbability(up, down);
    expect(p.upCents).toBe(30);
    expect(p.downCents).toBe(70);
    expect(p.upPct + p.downPct).toBe(100);
    // Scale both sides 10x — ratio identical.
    const p2 = impliedProbability(up * 10n, down * 10n);
    expect(p2.upCents).toBe(30);
    expect(p2.downCents).toBe(70);
  });
});

describe("v3SettlementDisplay", () => {
  it("OPEN returns LIVE phase with implied prob", () => {
    // 30% UP stake (crowd-certainty) → upCents=30.
    const d = v3SettlementDisplay("OPEN", 3_000n, 7_000n, null);
    expect(d.phase).toBe("LIVE");
    expect(d.upCents).toBe(30);
    expect(d.downCents).toBe(70);
  });

  it("RESOLVED+UP returns 100/0 SETTLED", () => {
    const d = v3SettlementDisplay("RESOLVED", 7_000n, 3_000n, "UP");
    expect(d.phase).toBe("SETTLED");
    expect(d.upCents).toBe(100 - V3_SETTLEMENT_EPSILON_CENTS);
    expect(d.downCents).toBe(V3_SETTLEMENT_EPSILON_CENTS);
    // Default epsilon = 0 per MASTER D3.
    expect(d.upCents).toBe(100);
    expect(d.downCents).toBe(0);
  });

  it("RESOLVED+DOWN returns 0/100 SETTLED", () => {
    const d = v3SettlementDisplay("RESOLVED", 7_000n, 3_000n, "DOWN");
    expect(d.phase).toBe("SETTLED");
    expect(d.upCents).toBe(0);
    expect(d.downCents).toBe(100);
  });

  it("RESOLVED+INVALID returns 50/50 VOID", () => {
    const d = v3SettlementDisplay("RESOLVED", 7_000n, 3_000n, "INVALID");
    expect(d.phase).toBe("VOID");
    expect(d.upCents).toBe(50);
    expect(d.downCents).toBe(50);
  });

  it("VOID state returns 50/50 VOID regardless of outcome", () => {
    const d = v3SettlementDisplay("VOID", 7_000n, 3_000n, null);
    expect(d.phase).toBe("VOID");
    expect(d.upCents).toBe(50);
    expect(d.downCents).toBe(50);
  });
});

describe("formatCentsShare", () => {
  it("100 → $1.00, 0 → 0¢, 25 → 25¢", () => {
    expect(formatCentsShare(100)).toBe("$1.00");
    expect(formatCentsShare(0)).toBe("0¢");
    expect(formatCentsShare(25)).toBe("25¢");
  });

  it("clamps extremes: 101 → $1.00, -1 → 0¢", () => {
    expect(formatCentsShare(101)).toBe("$1.00");
    expect(formatCentsShare(-1)).toBe("0¢");
  });

  it("rounds fractional input", () => {
    expect(formatCentsShare(24.6)).toBe("25¢");
    expect(formatCentsShare(24.4)).toBe("24¢");
  });
});

describe("formatPercent", () => {
  it("50 → 50%", () => {
    expect(formatPercent(50)).toBe("50%");
  });
});

describe("formatUsdFromCents", () => {
  it("null → em dash", () => {
    expect(formatUsdFromCents(null)).toBe("—");
  });

  it("bigint 7760103n → $77,601.03", () => {
    expect(formatUsdFromCents(7_760_103n)).toBe("$77,601.03");
  });

  it("stringified bigint works identically", () => {
    expect(formatUsdFromCents("7760103")).toBe("$77,601.03");
  });

  it("pads sub-dollar cents: 5n → $0.05", () => {
    expect(formatUsdFromCents(5n)).toBe("$0.05");
  });

  it("negative renders with leading sign", () => {
    expect(formatUsdFromCents(-123_45n)).toBe("-$123.45");
  });
});

describe("strikeVsLive", () => {
  it("null strike returns em-dash and null delta", () => {
    const r = strikeVsLive(null, "7760103");
    expect(r.strikeDisplay).toBe("—");
    expect(r.liveDisplay).toBe("$77,601.03");
    expect(r.deltaCents).toBe(null);
    expect(r.deltaPct).toBe(null);
    expect(r.direction).toBe(null);
  });

  it("both present: live above strike → up direction with positive delta", () => {
    const r = strikeVsLive("1000000", "1010000"); // strike $10,000 live $10,100
    expect(r.deltaCents).toBe(10_000n);
    expect(r.direction).toBe("up");
    expect(r.deltaPct).toBeCloseTo(1.0, 5);
  });

  it("live below strike → down direction with negative delta", () => {
    const r = strikeVsLive("1000000", "990000");
    expect(r.deltaCents).toBe(-10_000n);
    expect(r.direction).toBe("down");
    expect(r.deltaPct).toBeCloseTo(-1.0, 5);
  });

  it("equal prices → flat direction", () => {
    const r = strikeVsLive("1000000", "1000000");
    expect(r.deltaCents).toBe(0n);
    expect(r.direction).toBe("flat");
    expect(r.deltaPct).toBe(0);
  });
});

describe("sparklineVariantFor", () => {
  it("hysteresis ±5¢ — current==strike returns neutral", () => {
    expect(sparklineVariantFor("1000000", "1000000")).toBe("neutral");
  });

  it("hysteresis ±5¢ — +4¢ still neutral", () => {
    expect(sparklineVariantFor(1_000_004n, 1_000_000n)).toBe("neutral");
  });

  it("hysteresis ±5¢ — +6¢ returns up", () => {
    expect(sparklineVariantFor(1_000_006n, 1_000_000n)).toBe("up");
  });

  it("hysteresis ±5¢ — -6¢ returns down", () => {
    expect(sparklineVariantFor(999_994n, 1_000_000n)).toBe("down");
  });

  it("null input returns neutral", () => {
    expect(sparklineVariantFor(null, "1000000")).toBe("neutral");
    expect(sparklineVariantFor("1000000", null)).toBe("neutral");
  });
});

describe("curvePrices (pm-AMM marginal)", () => {
  it("uninitialized pool (0/0) returns 50/50¢", () => {
    // Lazy init at z=0 (P=0.5).
    const p = curvePrices(0n, 0n);
    expect(p.upCents).toBe(50);
    expect(p.downCents).toBe(50);
  });

  it("UP reserves < DOWN reserves → UP price > 50¢ (UP shares scarce)", () => {
    // In pm-AMM, x=YES reserves, y=NO reserves. When x < y, YES is scarce
    // and pricier. z = (y - x)/L > 0 → P(YES) = Φ(z) > 0.5.
    const p = curvePrices(20n * 100_000_000n, 60n * 100_000_000n); // x=20, y=60 (E8)
    expect(p.upCents).toBeGreaterThan(50);
    expect(p.upCents + p.downCents).toBe(100);
  });

  it("symmetric: swapping reserves mirrors the price", () => {
    const a = curvePrices(20n * 100_000_000n, 60n * 100_000_000n);
    const b = curvePrices(60n * 100_000_000n, 20n * 100_000_000n);
    expect(a.upCents).toBe(b.downCents);
    expect(a.downCents).toBe(b.upCents);
  });
});

describe("quoteBuy (pm-AMM)", () => {
  it("buy $1 UP from initial pool → positive shares, price moves up", () => {
    const q = quoteBuy(0n, 0n, "UP", 100n); // $1 from fresh pool
    expect(q.sharesE8).toBeGreaterThan(0n);
    expect(q.upPriceCentsAfter).toBeGreaterThan(50);
    expect(q.downPriceCentsAfter).toBeLessThan(50);
    expect(q.upPriceCentsAfter + q.downPriceCentsAfter).toBe(100);
    // avgPrice should be near 50¢ for a small trade against L=$100 pool
    expect(q.avgPriceCents).toBeGreaterThanOrEqual(50);
    expect(q.avgPriceCents).toBeLessThanOrEqual(60);
  });

  it("repeated UP buys push UP price monotonically up", () => {
    let up = 0n;
    let down = 0n;
    let prevPrice = 50;
    for (let i = 0; i < 5; i++) {
      const q = quoteBuy(up, down, "UP", 100n);
      expect(q.upPriceCentsAfter).toBeGreaterThanOrEqual(prevPrice);
      prevPrice = q.upPriceCentsAfter;
      up = q.newUpSharesE8;
      down = q.newDownSharesE8;
    }
  });

  it("DOWN buy mirrors UP buy at the same starting state", () => {
    const a = quoteBuy(0n, 0n, "UP", 500n);
    const b = quoteBuy(0n, 0n, "DOWN", 500n);
    expect(a.sharesE8).toBe(b.sharesE8);
    expect(a.upPriceCentsAfter).toBe(b.downPriceCentsAfter);
  });

  it("rejects zero or negative amount", () => {
    expect(() => quoteBuy(0n, 0n, "UP", 0n)).toThrow();
    expect(() => quoteBuy(0n, 0n, "UP", -10n)).toThrow();
  });
});

describe("quoteSell (pm-AMM)", () => {
  it("buy then sell same shares = exact round-trip (no self-arb)", () => {
    // Cardinal pm-AMM property: deterministic invariant means roundtrip
    // returns the same dollars (modulo rounding to nearest cent).
    const buyR = quoteBuy(0n, 0n, "UP", 500n); // $5 buy
    const sellR = quoteSell(
      buyR.newUpSharesE8,
      buyR.newDownSharesE8,
      "UP",
      buyR.sharesE8,
    );
    const drift = Number(sellR.proceedsCents) - 500;
    expect(Math.abs(drift)).toBeLessThanOrEqual(2); // ≤ 2¢ rounding tolerance
  });

  it("sell after price moved UP yields more than purchase cost (real arb)", () => {
    // User buys UP, someone else also buys UP pushing price higher,
    // user sells at the new higher price.
    const myBuy = quoteBuy(0n, 0n, "UP", 500n);
    // Other trader pushes UP further:
    const otherBuy = quoteBuy(myBuy.newUpSharesE8, myBuy.newDownSharesE8, "UP", 1000n);
    // Now I sell my shares at the elevated state:
    const mySell = quoteSell(
      otherBuy.newUpSharesE8,
      otherBuy.newDownSharesE8,
      "UP",
      myBuy.sharesE8,
    );
    expect(Number(mySell.proceedsCents)).toBeGreaterThan(500);
  });

  it("DOWN sell mirrors UP sell at symmetric state", () => {
    const buyUp = quoteBuy(0n, 0n, "UP", 500n);
    const buyDn = quoteBuy(0n, 0n, "DOWN", 500n);
    const sellUp = quoteSell(buyUp.newUpSharesE8, buyUp.newDownSharesE8, "UP", buyUp.sharesE8);
    const sellDn = quoteSell(buyDn.newUpSharesE8, buyDn.newDownSharesE8, "DOWN", buyDn.sharesE8);
    expect(sellUp.proceedsCents).toBe(sellDn.proceedsCents);
  });

  it("rejects zero or negative shares", () => {
    expect(() => quoteSell(0n, 0n, "UP", 0n)).toThrow();
    expect(() => quoteSell(0n, 0n, "UP", -10n)).toThrow();
  });
});

describe("isSeriesResolving", () => {
  const base = {
    currentCloseTimeSec: 1_700_000_000,
    currentResolvedOutcome: null as null | "UP" | "DOWN" | "INVALID",
  };

  it("nowMs/1000 >= closeTimeSec returns resolving=true", () => {
    const r = isSeriesResolving(base, 1_700_000_000 * 1000);
    expect(r.resolving).toBe(true);
    expect(r.winnerSide).toBe(null);
  });

  it("before close: resolving=false", () => {
    const r = isSeriesResolving(base, (1_700_000_000 - 10) * 1000);
    expect(r.resolving).toBe(false);
    expect(r.winnerSide).toBe(null);
  });

  it("winnerSide reflects currentResolvedOutcome=UP", () => {
    const r = isSeriesResolving(
      { ...base, currentResolvedOutcome: "UP" },
      1_700_000_001 * 1000,
    );
    expect(r.resolving).toBe(true);
    expect(r.winnerSide).toBe("UP");
  });

  it("winnerSide=DOWN when outcome=DOWN", () => {
    const r = isSeriesResolving(
      { ...base, currentResolvedOutcome: "DOWN" },
      1_700_000_001 * 1000,
    );
    expect(r.winnerSide).toBe("DOWN");
  });

  it("winnerSide=null when outcome=INVALID even while resolving", () => {
    const r = isSeriesResolving(
      { ...base, currentResolvedOutcome: "INVALID" },
      1_700_000_001 * 1000,
    );
    expect(r.resolving).toBe(true);
    expect(r.winnerSide).toBe(null);
  });
});
