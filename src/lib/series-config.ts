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

/**
 * v0.5 / Phase G — ECO event-driven binary product spec.
 * One spec per ECO series (CPI / Core PCE / Unemployment / GDP). Read by
 * `eco-spawn` (uses `spawnAheadSec` + `freezeBeforeReleaseSec` + `pythFeedId`)
 * and `eco-settle` (uses `settleMaxAgeSec` + `direction` + `pythFeedId`).
 *
 * Strike resolution v0:
 *   - `strikeSource = "hardcoded"` + `strikeValueRaw` (price_e8 / e8 native).
 *     Phase G+ may add "previous_release" (lookup last actual_released_price)
 *     and "consensus_static" (operator-curated consensus from BLS prelim).
 */
export type EcoEventType =
  | "us_cpi_mom"
  | "us_core_pce_mom"
  | "us_unemployment"
  | "us_gdp_qoq";

export interface EventDrivenSpec {
  eventType: EcoEventType;
  /** Where strikePriceE8 comes from for newly-spawned ECO cases. */
  strikeSource: "previous_release" | "consensus_static" | "hardcoded";
  /** Raw E8 value, only used when strikeSource === "hardcoded". */
  strikeValueRaw?: bigint;
  /** YES wins when actual `direction` strike — UP for ABOVE, DOWN for BELOW. */
  direction: "ABOVE" | "BELOW";
  /** How far ahead of release the case is spawned (default 7 days = 604800s). */
  spawnAheadSec: number;
  /** Buffer before release where mutations freeze (closeTime = release - this). */
  freezeBeforeReleaseSec: number;
  /** Spacing between settle-poll attempts (informational only; cron drives cadence). */
  settlePollAfterReleaseSec: number;
  /** Hard ceiling: if release+settleMaxAgeSec passes with no fresh tick → VOID. */
  settleMaxAgeSec: number;
  /** 64-char hex hermes-beta Pyth feed id (no 0x). Same shape as rolling series. */
  pythFeedId: string;
}

export interface SeriesStaticConfig {
  // Was strict `SeriesId` literal union; relaxed to `string` so DB-driven
  // series_v3 rows (whose ids are dynamic — e.g. sol-15m-strike-up — and
  // grow over time) can flow through the same shape without forcing the
  // SeriesId union to enumerate every Phase D/G addition.
  seriesId: string;
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
  /** v0.5 series kind. Defaults "rolling" (existing 3m/1h cadence rounds).
   *  "event_driven" → ECO series (CPI/PCE/etc.) handled by eco-spawn / eco-settle. */
  kind?: "rolling" | "event_driven";
  /** Required when kind === "event_driven". */
  eventDriven?: EventDrivenSpec;
  /** pm-AMM L override in dollars. NULL → env PM_AMM_L_DOLLARS. ECO uses 300. */
  pmAmmLDollars?: number;
}

// Anchor time: 2026-04-24 00:00:00 UTC (demo start)
// All series share this anchor so round_idx aligns across cadences.
export const SERIES_START_ANCHOR_SEC = 1776988800;

/**
 * @deprecated As of v0.5+, the source of truth for active series is the
 * `series_v3` DB table — `/api/series` reads it directly via cachedView.
 * This const is retained for:
 *   1. First-time DB seed (`npm run db:seed`) on a fresh dev environment.
 *   2. Helper consumers (e.g. `cron/tick`) that still iterate the static
 *      list. Those callsites should migrate to a DB query when convenient.
 *
 * **Adding a new series**: do NOT append here. Either INSERT directly into
 * `series_v3` or use the future `npm run seed:series add` CLI (Phase B).
 */
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
  return SERIES_BY_ID[id as SeriesId] ?? ECO_SERIES_BY_ID[id];
}

// ───────────────────── ECO series (Phase G) ─────────────────────
// v0 demo: status, BLS calendar + Pyth ECO feed ids reviewed each quarter.
// Pyth ECO feed ids on hermes-beta — verify before flipping isActive.
// PM_AMM_L override = $300 per series (vs $100 rolling) — long tenor, larger pool.
//
// IMPORTANT: ECO series live in a separate registry (ECO_SERIES_CONFIG) and
// are NOT included in the rolling SERIES_CONFIG iterated by `cron/tick`. The
// dedicated `cron/eco-spawn` + `cron/eco-settle` routes pick these up. This
// avoids feeding event_driven cases into the rolling rotation loop. Phase E
// will additionally add a defensive `if (kind==='event_driven') continue;`
// guard inside `cron/tick/route.ts::rotateSeriesRounds`.

/** Loose ECO series config — does NOT flow through strict SeriesId/Category
 * types in v3-api.ts (those are reserved for the rolling product surface). */
export interface EcoSeriesConfig
  extends Omit<SeriesStaticConfig, "seriesId" | "category" | "kind"> {
  seriesId: string;
  category: SeriesCategory;
  kind: "event_driven";
  eventDriven: EventDrivenSpec;
}

const ECO_SPAWN_AHEAD_SEC = 7 * 86400; // 604800
const ECO_FREEZE_BEFORE_RELEASE_SEC = 60;
const ECO_SETTLE_POLL_SEC = 5;
const ECO_SETTLE_MAX_AGE_SEC = 1800; // 30 min
const ECO_PM_AMM_L_DOLLARS = 300;

export const ECO_SERIES_CONFIG: readonly EcoSeriesConfig[] = [
  {
    seriesId: "eco-cpi-mom-monthly",
    assetSymbol: "US_CPI_MOM",
    pair: "US_CPI_MOM/PCT",
    // Phase F will add "macro" category enum — until then mark as crypto_ext
    // so the Phase A schema FK + frontend list code don't trip over the value.
    // (eco-* groupId prefix is the Phase F UI-tab discriminator anyway.)
    category: "crypto_ext",
    cadenceSec: 0, // ECO is event-driven, not cadence-driven
    pythFeedId: "f3b50961ff387a3d68217e2715637d0add6013e7ecb2d7b6f6b8b1b8b6b8b8b8",
    marketHoursGated: false,
    feeBps: 200,
    sortOrder: 100,
    seriesStartSec: SERIES_START_ANCHOR_SEC,
    kind: "event_driven",
    pmAmmLDollars: ECO_PM_AMM_L_DOLLARS,
    eventDriven: {
      eventType: "us_cpi_mom",
      strikeSource: "hardcoded",
      strikeValueRaw: 30_000_000n, // 0.30% MoM at e8 — placeholder; Phase F revises
      direction: "ABOVE",
      spawnAheadSec: ECO_SPAWN_AHEAD_SEC,
      freezeBeforeReleaseSec: ECO_FREEZE_BEFORE_RELEASE_SEC,
      settlePollAfterReleaseSec: ECO_SETTLE_POLL_SEC,
      settleMaxAgeSec: ECO_SETTLE_MAX_AGE_SEC,
      pythFeedId: "f3b50961ff387a3d68217e2715637d0add6013e7ecb2d7b6f6b8b1b8b6b8b8b8",
    },
  },
  {
    seriesId: "eco-core-pce-monthly",
    assetSymbol: "US_CORE_PCE_MOM",
    pair: "US_CORE_PCE_MOM/PCT",
    category: "crypto_ext",
    cadenceSec: 0,
    pythFeedId: "a6c1bc8ab8b6b8b6b8b6b8b6b8b6b8b6b8b6b8b6b8b6b8b6b8b6b8b6b8b6b8b6",
    marketHoursGated: false,
    feeBps: 200,
    sortOrder: 101,
    seriesStartSec: SERIES_START_ANCHOR_SEC,
    kind: "event_driven",
    pmAmmLDollars: ECO_PM_AMM_L_DOLLARS,
    eventDriven: {
      eventType: "us_core_pce_mom",
      strikeSource: "hardcoded",
      strikeValueRaw: 25_000_000n, // 0.25% MoM placeholder
      direction: "ABOVE",
      spawnAheadSec: ECO_SPAWN_AHEAD_SEC,
      freezeBeforeReleaseSec: ECO_FREEZE_BEFORE_RELEASE_SEC,
      settlePollAfterReleaseSec: ECO_SETTLE_POLL_SEC,
      settleMaxAgeSec: ECO_SETTLE_MAX_AGE_SEC,
      pythFeedId: "a6c1bc8ab8b6b8b6b8b6b8b6b8b6b8b6b8b6b8b6b8b6b8b6b8b6b8b6b8b6b8b6",
    },
  },
  {
    seriesId: "eco-unemployment-monthly",
    assetSymbol: "US_UNRATE",
    pair: "US_UNRATE/PCT",
    category: "crypto_ext",
    cadenceSec: 0,
    pythFeedId: "b7c2cd9bc9c7c9c7c9c7c9c7c9c7c9c7c9c7c9c7c9c7c9c7c9c7c9c7c9c7c9c7",
    marketHoursGated: false,
    feeBps: 200,
    sortOrder: 102,
    seriesStartSec: SERIES_START_ANCHOR_SEC,
    kind: "event_driven",
    pmAmmLDollars: ECO_PM_AMM_L_DOLLARS,
    eventDriven: {
      eventType: "us_unemployment",
      strikeSource: "hardcoded",
      strikeValueRaw: 410_000_000n, // 4.10% UNRATE at e8 placeholder
      direction: "ABOVE",
      spawnAheadSec: ECO_SPAWN_AHEAD_SEC,
      freezeBeforeReleaseSec: ECO_FREEZE_BEFORE_RELEASE_SEC,
      settlePollAfterReleaseSec: ECO_SETTLE_POLL_SEC,
      settleMaxAgeSec: ECO_SETTLE_MAX_AGE_SEC,
      pythFeedId: "b7c2cd9bc9c7c9c7c9c7c9c7c9c7c9c7c9c7c9c7c9c7c9c7c9c7c9c7c9c7c9c7",
    },
  },
  {
    seriesId: "eco-gdp-qoq-quarterly",
    assetSymbol: "US_GDP_QOQ",
    pair: "US_GDP_QOQ/PCT",
    category: "crypto_ext",
    cadenceSec: 0,
    pythFeedId: "c8d3deacdadbdadbdadbdadbdadbdadbdadbdadbdadbdadbdadbdadbdadbdadb",
    marketHoursGated: false,
    feeBps: 200,
    sortOrder: 103,
    seriesStartSec: SERIES_START_ANCHOR_SEC,
    kind: "event_driven",
    pmAmmLDollars: ECO_PM_AMM_L_DOLLARS,
    eventDriven: {
      eventType: "us_gdp_qoq",
      strikeSource: "hardcoded",
      strikeValueRaw: 200_000_000n, // 2.00% QoQ placeholder
      direction: "ABOVE",
      spawnAheadSec: ECO_SPAWN_AHEAD_SEC,
      freezeBeforeReleaseSec: ECO_FREEZE_BEFORE_RELEASE_SEC,
      settlePollAfterReleaseSec: ECO_SETTLE_POLL_SEC,
      settleMaxAgeSec: ECO_SETTLE_MAX_AGE_SEC,
      pythFeedId: "c8d3deacdadbdadbdadbdadbdadbdadbdadbdadbdadbdadbdadbdadbdadbdadb",
    },
  },
];

export const ECO_SERIES_BY_ID: Record<string, EcoSeriesConfig> =
  ECO_SERIES_CONFIG.reduce(
    (acc, s) => ({ ...acc, [s.seriesId]: s }),
    {} as Record<string, EcoSeriesConfig>,
  );

/** Map calendar `event_type` → seriesId. Used by eco-spawn when picking the
 *  series row to spawn a case under for a calendar entry. */
export const ECO_EVENT_TYPE_TO_SERIES_ID: Record<EcoEventType, string> = {
  us_cpi_mom: "eco-cpi-mom-monthly",
  us_core_pce_mom: "eco-core-pce-monthly",
  us_unemployment: "eco-unemployment-monthly",
  us_gdp_qoq: "eco-gdp-qoq-quarterly",
};

export function getEcoSeriesByEventType(
  eventType: string,
): EcoSeriesConfig | undefined {
  const seriesId = ECO_EVENT_TYPE_TO_SERIES_ID[eventType as EcoEventType];
  return seriesId ? ECO_SERIES_BY_ID[seriesId] : undefined;
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
