import { describe, it, expect } from "vitest";
import {
  MACRO_CALENDAR_2026,
  BLACKOUT_WINDOW_SEC,
  isMacroBlackout,
  eventAffectsAsset,
  type MacroEvent,
} from "../macro-calendar";

describe("MACRO_CALENDAR_2026 sanity", () => {
  it("contains at least 5 FOMC + 6 CPI + 6 NFP entries", () => {
    const buckets = { FOMC: 0, CPI: 0, NFP: 0, PCE: 0, GDP: 0 };
    for (const ev of MACRO_CALENDAR_2026) buckets[ev.name]++;
    expect(buckets.FOMC).toBeGreaterThanOrEqual(5);
    expect(buckets.CPI).toBeGreaterThanOrEqual(6);
    expect(buckets.NFP).toBeGreaterThanOrEqual(6);
  });

  it("every event has a positive unix-sec startSec", () => {
    for (const ev of MACRO_CALENDAR_2026) {
      expect(ev.startSec).toBeGreaterThan(1_700_000_000);
    }
  });

  it("BLACKOUT_WINDOW_SEC = 1800", () => {
    expect(BLACKOUT_WINDOW_SEC).toBe(1800);
  });
});

describe("isMacroBlackout — boundary inclusivity", () => {
  // Pick a representative "all" event.
  const evt: MacroEvent = MACRO_CALENDAR_2026[0];

  it("blackout=true at startSec − 1800 (lower edge inclusive)", () => {
    const r = isMacroBlackout("BTC", evt.startSec - 1800);
    expect(r.blackout).toBe(true);
  });

  it("blackout=false at startSec − 1801 (one second outside)", () => {
    const r = isMacroBlackout("BTC", evt.startSec - 1801);
    expect(r.blackout).toBe(false);
  });

  it("blackout=true at startSec + 1800 (upper edge inclusive)", () => {
    const r = isMacroBlackout("BTC", evt.startSec + 1800);
    expect(r.blackout).toBe(true);
  });

  it("blackout=false at startSec + 1801", () => {
    const r = isMacroBlackout("BTC", evt.startSec + 1801);
    expect(r.blackout).toBe(false);
  });

  it("blackout=true at startSec exactly", () => {
    const r = isMacroBlackout("BTC", evt.startSec);
    expect(r.blackout).toBe(true);
    expect(r.reason).toContain(evt.name);
    expect(r.clearAtSec).toBe(evt.startSec + BLACKOUT_WINDOW_SEC + 1);
  });
});

describe("isMacroBlackout — quiet windows", () => {
  it("no blackout at far-future timestamp (year 2030)", () => {
    const future = Math.floor(Date.UTC(2030, 5, 1) / 1000);
    const r = isMacroBlackout("BTC", future);
    expect(r.blackout).toBe(false);
  });

  it("no blackout at early 2026 between scheduled events", () => {
    // Find a 24-hour gap between events to test mid-gap.
    const sorted = [...MACRO_CALENDAR_2026].sort((a, b) => a.startSec - b.startSec);
    let testTime = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].startSec - sorted[i - 1].startSec;
      if (gap > 6 * 3600) {
        testTime = sorted[i - 1].startSec + Math.floor(gap / 2);
        break;
      }
    }
    expect(testTime).toBeGreaterThan(0);
    const r = isMacroBlackout("BTC", testTime);
    expect(r.blackout).toBe(false);
  });
});

describe("eventAffectsAsset — category filter", () => {
  const allEvent: MacroEvent = { name: "FOMC", startSec: 1_800_000_000, affects: "all" };
  const equityEvent: MacroEvent = { name: "GDP", startSec: 1_800_000_000, affects: "equity" };
  const cryptoEvent: MacroEvent = { name: "FOMC", startSec: 1_800_000_000, affects: "crypto" };
  const fxEvent: MacroEvent = { name: "FOMC", startSec: 1_800_000_000, affects: "fx" };
  const commodityEvent: MacroEvent = { name: "FOMC", startSec: 1_800_000_000, affects: "commodity" };

  it("'all' affects every asset bucket", () => {
    for (const a of ["BTC", "ETH", "SOL", "XAU", "BRENT", "QQQ", "EURUSD", "USDJPY"]) {
      expect(eventAffectsAsset(allEvent, a)).toBe(true);
    }
  });

  it("'equity' affects QQQ but not crypto/commodity/fx", () => {
    expect(eventAffectsAsset(equityEvent, "QQQ")).toBe(true);
    expect(eventAffectsAsset(equityEvent, "BTC")).toBe(false);
    expect(eventAffectsAsset(equityEvent, "XAU")).toBe(false);
    expect(eventAffectsAsset(equityEvent, "EURUSD")).toBe(false);
  });

  it("'crypto' affects BTC/ETH/SOL only", () => {
    expect(eventAffectsAsset(cryptoEvent, "BTC")).toBe(true);
    expect(eventAffectsAsset(cryptoEvent, "ETH")).toBe(true);
    expect(eventAffectsAsset(cryptoEvent, "SOL")).toBe(true);
    expect(eventAffectsAsset(cryptoEvent, "XAU")).toBe(false);
    expect(eventAffectsAsset(cryptoEvent, "QQQ")).toBe(false);
  });

  it("'commodity' affects XAU/XAG/XPT/BRENT only", () => {
    expect(eventAffectsAsset(commodityEvent, "XAU")).toBe(true);
    expect(eventAffectsAsset(commodityEvent, "XAG")).toBe(true);
    expect(eventAffectsAsset(commodityEvent, "XPT")).toBe(true);
    expect(eventAffectsAsset(commodityEvent, "BRENT")).toBe(true);
    expect(eventAffectsAsset(commodityEvent, "BTC")).toBe(false);
  });

  it("'fx' affects EURUSD/USDJPY/USDCNH only", () => {
    expect(eventAffectsAsset(fxEvent, "EURUSD")).toBe(true);
    expect(eventAffectsAsset(fxEvent, "USDJPY")).toBe(true);
    expect(eventAffectsAsset(fxEvent, "USDCNH")).toBe(true);
    expect(eventAffectsAsset(fxEvent, "BTC")).toBe(false);
    expect(eventAffectsAsset(fxEvent, "XAU")).toBe(false);
  });

  it("works with prefix-form series ids", () => {
    expect(eventAffectsAsset(cryptoEvent, "btc-usdc-3m")).toBe(true);
    expect(eventAffectsAsset(equityEvent, "qqq-1d-up")).toBe(true);
  });
});

describe("isMacroBlackout — asset filter integration", () => {
  it("an equity-only GDP blackout does not gate BTC", () => {
    const gdp = MACRO_CALENDAR_2026.find((e) => e.name === "GDP");
    expect(gdp).toBeDefined();
    if (!gdp) return;
    // Exactly at the GDP release moment, BTC should not be in blackout
    // (GDP affects only equity).
    expect(isMacroBlackout("BTC", gdp.startSec).blackout).toBe(false);
    expect(isMacroBlackout("QQQ", gdp.startSec).blackout).toBe(true);
  });
});
