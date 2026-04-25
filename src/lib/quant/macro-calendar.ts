/**
 * Macro-event blackout calendar — Basement v0.5 Phase B.
 *
 * Hardcoded list of high-impact US macro releases (FOMC / CPI / NFP / PCE /
 * GDP) for the next ~6 months. Cron callers ask `isMacroBlackout(asset, now)`
 * before spawning new rounds — within ±30 min of a release the σ regime is
 * unstable, so we'd rather skip and re-spawn one cron tick later than burn
 * a round on a degenerate strike.
 *
 * 2026 schedule sourced from:
 *   - FOMC: federalreserve.gov/monetarypolicy/fomccalendars.htm
 *   - CPI:  bls.gov/schedule/news_release/cpi.htm
 *   - NFP:  bls.gov/schedule/news_release/empsit.htm (first Friday of month)
 *   - PCE:  bea.gov/news/schedule
 *   - GDP:  bea.gov/news/schedule (advance: late month after quarter end)
 *
 * Times are UTC unix seconds. US release time is 8:30 AM ET = 12:30/13:30
 * UTC depending on DST; FOMC statement is 2:00 PM ET = 18:00/19:00 UTC.
 *
 * v0 simplification: hardcode events as plain unix-sec timestamps; v1 will
 * pull from a calendar table. The list does not need to be exhaustive — it
 * just needs to cover the next quarter so spawn cron has runway.
 */

import type { BlackoutResult } from "./types";

export const BLACKOUT_WINDOW_SEC = 30 * 60; // ±30 min

export interface MacroEvent {
  name: "FOMC" | "CPI" | "NFP" | "PCE" | "GDP";
  /** Unix seconds UTC of the release moment. */
  startSec: number;
  /** Which asset bucket this event materially moves. */
  affects: "all" | "crypto" | "equity" | "commodity" | "fx";
}

/** Helper: convert a UTC date+time to unix seconds. */
function utc(year: number, monthIdx0: number, day: number, hour: number, minute: number): number {
  return Math.floor(Date.UTC(year, monthIdx0, day, hour, minute, 0) / 1000);
}

/**
 * 2026 high-impact US macro releases. Times in UTC.
 * Note: ET → UTC offset is +4h during DST (Mar–Nov) and +5h otherwise.
 *   8:30 AM ET = 13:30 UTC (DST) or 12:30 UTC (standard time)
 *   2:00 PM ET = 19:00 UTC (DST) or 18:00 UTC (standard time)
 *   8:30 AM ET in May–Oct → use 12:30 UTC.
 */
export const MACRO_CALENDAR_2026: MacroEvent[] = [
  // ─── FOMC 2026 (8 scheduled meetings; statement 2pm ET; 18:00 UTC DST) ─
  { name: "FOMC", startSec: utc(2026, 0, 28, 19, 0), affects: "all" },     // Jan 28 (EST)
  { name: "FOMC", startSec: utc(2026, 2, 18, 18, 0), affects: "all" },     // Mar 18 (EDT)
  { name: "FOMC", startSec: utc(2026, 3, 29, 18, 0), affects: "all" },     // Apr 29 (EDT)
  { name: "FOMC", startSec: utc(2026, 5, 17, 18, 0), affects: "all" },     // Jun 17 (EDT)
  { name: "FOMC", startSec: utc(2026, 6, 29, 18, 0), affects: "all" },     // Jul 29 (EDT)
  { name: "FOMC", startSec: utc(2026, 8, 16, 18, 0), affects: "all" },     // Sep 16 (EDT)
  { name: "FOMC", startSec: utc(2026, 10, 4, 19, 0), affects: "all" },     // Nov  4 (EST after DST end)
  { name: "FOMC", startSec: utc(2026, 11, 16, 19, 0), affects: "all" },    // Dec 16 (EST)

  // ─── CPI 2026 (BLS, 8:30 AM ET; ~14th of each month) ───────────────────
  { name: "CPI", startSec: utc(2026, 0, 14, 13, 30), affects: "all" },     // Jan 14 (EST → 13:30 UTC)
  { name: "CPI", startSec: utc(2026, 1, 11, 13, 30), affects: "all" },     // Feb 11
  { name: "CPI", startSec: utc(2026, 2, 11, 12, 30), affects: "all" },     // Mar 11 (DST started Mar 8 → 12:30 UTC)
  { name: "CPI", startSec: utc(2026, 3, 14, 12, 30), affects: "all" },     // Apr 14
  { name: "CPI", startSec: utc(2026, 4, 13, 12, 30), affects: "all" },     // May 13
  { name: "CPI", startSec: utc(2026, 5, 10, 12, 30), affects: "all" },     // Jun 10
  { name: "CPI", startSec: utc(2026, 6, 15, 12, 30), affects: "all" },     // Jul 15
  { name: "CPI", startSec: utc(2026, 7, 12, 12, 30), affects: "all" },     // Aug 12
  { name: "CPI", startSec: utc(2026, 8, 10, 12, 30), affects: "all" },     // Sep 10
  { name: "CPI", startSec: utc(2026, 9, 14, 12, 30), affects: "all" },     // Oct 14

  // ─── NFP 2026 (BLS Employment Situation, 8:30 AM ET, first Fri) ────────
  { name: "NFP", startSec: utc(2026, 0, 9, 13, 30), affects: "all" },      // Jan  9 (EST)
  { name: "NFP", startSec: utc(2026, 1, 6, 13, 30), affects: "all" },      // Feb  6
  { name: "NFP", startSec: utc(2026, 2, 6, 13, 30), affects: "all" },      // Mar  6 (still EST → 13:30)
  { name: "NFP", startSec: utc(2026, 3, 3, 12, 30), affects: "all" },      // Apr  3 (EDT → 12:30)
  { name: "NFP", startSec: utc(2026, 4, 1, 12, 30), affects: "all" },      // May  1
  { name: "NFP", startSec: utc(2026, 5, 5, 12, 30), affects: "all" },      // Jun  5
  { name: "NFP", startSec: utc(2026, 6, 3, 12, 30), affects: "all" },      // Jul  3
  { name: "NFP", startSec: utc(2026, 7, 7, 12, 30), affects: "all" },      // Aug  7
  { name: "NFP", startSec: utc(2026, 8, 4, 12, 30), affects: "all" },      // Sep  4
  { name: "NFP", startSec: utc(2026, 9, 2, 12, 30), affects: "all" },      // Oct  2

  // ─── Core PCE 2026 (BEA, 8:30 AM ET, last Friday-ish) ──────────────────
  { name: "PCE", startSec: utc(2026, 0, 30, 13, 30), affects: "all" },     // Jan 30
  { name: "PCE", startSec: utc(2026, 1, 27, 13, 30), affects: "all" },     // Feb 27
  { name: "PCE", startSec: utc(2026, 2, 27, 12, 30), affects: "all" },     // Mar 27
  { name: "PCE", startSec: utc(2026, 3, 30, 12, 30), affects: "all" },     // Apr 30
  { name: "PCE", startSec: utc(2026, 4, 29, 12, 30), affects: "all" },     // May 29
  { name: "PCE", startSec: utc(2026, 5, 26, 12, 30), affects: "all" },     // Jun 26

  // ─── GDP 2026 (BEA advance Q1/Q2 etc, 8:30 AM ET) ──────────────────────
  { name: "GDP", startSec: utc(2026, 3, 29, 12, 30), affects: "equity" },  // Q1 Apr 29
  { name: "GDP", startSec: utc(2026, 6, 30, 12, 30), affects: "equity" },  // Q2 Jul 30
  { name: "GDP", startSec: utc(2026, 9, 29, 12, 30), affects: "equity" },  // Q3 Oct 29
];

/**
 * Bucket an asset symbol or series id into one of the macro affect categories.
 * Returns the category used to filter `MacroEvent.affects`.
 */
function assetCategory(asset: string): "crypto" | "equity" | "commodity" | "fx" | "unknown" {
  const upper = asset.toUpperCase();
  const head = upper.split("-")[0];

  if (["BTC", "ETH", "SOL", "HYPE", "MATIC", "APT"].includes(head)) return "crypto";
  if (["XAU", "XAG", "XPT", "BRENT"].includes(head)) return "commodity";
  if (["QQQ", "SPY", "DIA", "IWM"].includes(head)) return "equity";
  if (["EUR", "USD", "JPY", "CNH", "GBP", "EURUSD", "USDJPY", "USDCNH"].includes(head)) return "fx";
  return "unknown";
}

/**
 * Does `event` materially move `asset`? `affects: "all"` is universal;
 * otherwise the event's category must match the asset's category.
 */
export function eventAffectsAsset(event: MacroEvent, asset: string): boolean {
  if (event.affects === "all") return true;
  const cat = assetCategory(asset);
  if (cat === "unknown") return false;
  return event.affects === cat;
}

/**
 * Returns blackout=true iff `nowSec` is within ±BLACKOUT_WINDOW_SEC of any
 * macro event that affects `asset`.
 *
 * Edge convention: window is INCLUSIVE on both sides.
 *   nowSec = startSec − 1800 → blackout (boundary)
 *   nowSec = startSec − 1801 → clear
 *   nowSec = startSec + 1800 → blackout
 *   nowSec = startSec + 1801 → clear
 */
export function isMacroBlackout(asset: string, nowSec: number): BlackoutResult {
  for (const ev of MACRO_CALENDAR_2026) {
    if (!eventAffectsAsset(ev, asset)) continue;
    const delta = nowSec - ev.startSec;
    if (Math.abs(delta) <= BLACKOUT_WINDOW_SEC) {
      return {
        blackout: true,
        reason: `${ev.name} ±30min window`,
        clearAtSec: ev.startSec + BLACKOUT_WINDOW_SEC + 1,
      };
    }
  }
  return { blackout: false };
}
