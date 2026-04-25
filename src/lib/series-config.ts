/**
 * Basement v3 series configuration — single source of truth for the 7
 * recurring prediction-market series. Used by:
 *   - cron/tick to spawn & resolve cases
 *   - API /api/series to return metadata
 *   - frontend hooks for UI rendering
 *
 * Pyth feed IDs verified on Aptos mainnet (Agent E Round 2, 2026-04-23).
 * Testnet uses hermes-beta channel; same feed IDs.
 */

import type { SeriesCategory, SeriesId } from "./types/v3-api";

export interface SeriesStaticConfig {
  seriesId: SeriesId;
  assetSymbol: string;
  pair: string;
  category: SeriesCategory;
  cadenceSec: number;
  /** 64-char hex, no 0x prefix — matches Pyth feed_id as used in Hermes API */
  pythFeedId: string;
  /** Mon-Fri 9:30-16:00 ET for US stocks */
  marketHoursGated: boolean;
  /** Fee in basis points (200 = 2%). Taken from loser pool. */
  feeBps: number;
  sortOrder: number;
  /** Unix seconds origin for round_idx calculation. Deterministic across
   * deploys — tied to an anchor time so round_idx stays stable. */
  seriesStartSec: number;
}

// Anchor time: 2026-04-24 00:00:00 UTC (demo start)
// All series share this anchor so round_idx aligns across cadences.
export const SERIES_START_ANCHOR_SEC = 1776988800;

export const SERIES_CONFIG: readonly SeriesStaticConfig[] = [
  {
    seriesId: "btc-usdc-3m",
    assetSymbol: "BTC",
    pair: "BTC/USDC",
    category: "quick_play",
    cadenceSec: 180,
    pythFeedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    marketHoursGated: false,
    feeBps: 200,
    sortOrder: 1,
    seriesStartSec: SERIES_START_ANCHOR_SEC,
  },
  {
    seriesId: "eth-usdc-3m",
    assetSymbol: "ETH",
    pair: "ETH/USDC",
    category: "quick_play",
    cadenceSec: 180,
    pythFeedId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    marketHoursGated: false,
    feeBps: 200,
    sortOrder: 2,
    seriesStartSec: SERIES_START_ANCHOR_SEC,
  },
  {
    seriesId: "sol-usdc-3m",
    assetSymbol: "SOL",
    pair: "SOL/USDC",
    category: "crypto_ext",
    cadenceSec: 180,
    pythFeedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    marketHoursGated: false,
    feeBps: 200,
    sortOrder: 3,
    seriesStartSec: SERIES_START_ANCHOR_SEC,
  },
  {
    seriesId: "xau-usdc-1h",
    assetSymbol: "XAU",
    pair: "XAU/USDC",
    category: "commodity",
    cadenceSec: 3600,
    pythFeedId: "765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2",
    marketHoursGated: false, // spot gold is 24/5; weekend gate optional
    feeBps: 200,
    sortOrder: 4,
    seriesStartSec: SERIES_START_ANCHOR_SEC,
  },
  {
    seriesId: "xag-usdc-1h",
    assetSymbol: "XAG",
    pair: "XAG/USDC",
    category: "commodity",
    cadenceSec: 3600,
    pythFeedId: "f2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e",
    marketHoursGated: false,
    feeBps: 200,
    sortOrder: 5,
    seriesStartSec: SERIES_START_ANCHOR_SEC,
  },
  {
    seriesId: "us500-usdc-1h",
    assetSymbol: "US500",
    pair: "US500/USDC",
    category: "stocks",
    cadenceSec: 3600,
    pythFeedId: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
    marketHoursGated: true, // NYSE hours
    feeBps: 200,
    sortOrder: 6,
    seriesStartSec: SERIES_START_ANCHOR_SEC,
  },
  {
    seriesId: "hype-usdc-1h",
    assetSymbol: "HYPE",
    pair: "HYPE/USDC",
    category: "crypto_ext",
    cadenceSec: 3600,
    pythFeedId: "4279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b",
    marketHoursGated: false,
    feeBps: 200,
    sortOrder: 7,
    seriesStartSec: SERIES_START_ANCHOR_SEC,
  },
];

export const SERIES_BY_ID: Record<SeriesId, SeriesStaticConfig> =
  SERIES_CONFIG.reduce(
    (acc, s) => ({ ...acc, [s.seriesId]: s }),
    {} as Record<SeriesId, SeriesStaticConfig>,
  );

export function getSeries(id: string): SeriesStaticConfig | undefined {
  return SERIES_BY_ID[id as SeriesId];
}

/** round_idx = floor((now - series_start) / cadence) — monotonic, resilient to cron delay */
export function computeCurrentRoundIdx(
  series: Pick<SeriesStaticConfig, "seriesStartSec" | "cadenceSec">,
  nowSec: number = Math.floor(Date.now() / 1000),
): number {
  return Math.floor((nowSec - series.seriesStartSec) / series.cadenceSec);
}

export function computeRoundStart(
  series: Pick<SeriesStaticConfig, "seriesStartSec" | "cadenceSec">,
  roundIdx: number,
): number {
  return series.seriesStartSec + roundIdx * series.cadenceSec;
}

export function computeRoundClose(
  series: Pick<SeriesStaticConfig, "seriesStartSec" | "cadenceSec">,
  roundIdx: number,
): number {
  return series.seriesStartSec + (roundIdx + 1) * series.cadenceSec;
}

/** NYSE hours gate for US500. Mon-Fri 9:30 am – 4:00 pm ET. */
export function isMarketOpen(
  series: Pick<SeriesStaticConfig, "marketHoursGated">,
  nowSec: number = Math.floor(Date.now() / 1000),
): { open: boolean; reason?: "weekend" | "holiday" | "pre-open" | "post-close" } {
  if (!series.marketHoursGated) return { open: true };
  // Translate nowSec → NY wall-clock via Intl
  const d = new Date(nowSec * 1000);
  const ny = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const weekday = ny.find((p) => p.type === "weekday")?.value ?? "";
  const hour = parseInt(ny.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(ny.find((p) => p.type === "minute")?.value ?? "0", 10);
  if (weekday === "Sat" || weekday === "Sun") return { open: false, reason: "weekend" };
  const minuteOfDay = hour * 60 + minute;
  const openMin = 9 * 60 + 30;
  const closeMin = 16 * 60;
  if (minuteOfDay < openMin) return { open: false, reason: "pre-open" };
  if (minuteOfDay >= closeMin) return { open: false, reason: "post-close" };
  return { open: true };
}
