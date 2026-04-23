/**
 * Basement — Market Group Registry (Phase 2, Session E)
 *
 * Single source of truth for recurring / cadence-driven market groups. Consumed
 * by the spawn-recurring + resolve-onchain cron routes and the legacy DB-side
 * markets-query auto-refresh loop. Adding a new group (e.g. `sol-3m`, a daily
 * Friday close, a UCRT-resolved manual group) only requires appending a record
 * here — no code changes in the consumers.
 *
 * Env-free by design: this module imports ONLY from `./aptos` (for the lazy
 * Pyth feed-id getters). Feed ids are resolved via {@link pythFeedForGroup} at
 * call-time so module import stays side-effect-free.
 */
import { pythBtcFeedId, pythEthFeedId } from "./aptos";

export type ResolutionKind = "pyth" | "switchboard" | "supra" | "manual" | "ucrt";
export type SpawnCadence =
  | "on-resolve"
  | "daily-00-utc"
  | "weekly-friday"
  | "manual";

/** UI-level asset class bucket. Drives the Crypto/Stocks/Commodity/Others tabs
 *  in market-grid.tsx. Declared here so the registry is the single source. */
export type Category = "crypto" | "stocks" | "commodity" | "others";

export interface MarketGroupSpec {
  groupId: string;
  assetSymbol: string;
  /** Top-level tab on the markets page. */
  category: Category;
  /** Alphabetical sort key within a tab (e.g. "BTC" / "ETH" / "XAU"). */
  sortName: string;
  resolutionKind: ResolutionKind;
  /** Hex bytes32 Pyth feed id. Left empty in the literal; resolve via
   *  {@link pythFeedForGroup} which reads env lazily. */
  pythFeedId?: string;
  /** Switchboard Aptos aggregator object address (hex). Populated for
   *  resolutionKind === "switchboard" groups after the 1c spike. */
  switchboardAggregatorAddr?: string;
  durationSec: number;
  /** Strike-rounding tick in Pyth 1e8 fixed-point (BTC $500 = 50_000_000_000n). */
  tickSize: bigint;
  /** AMM pool-seed vUSD at FA 1e6 decimals (500 vUSD = 500_000_000n). */
  poolDepth: bigint;
  spawnCadence: SpawnCadence;
  /** Supports `{asset}` `{strike}` `{closeTime}` placeholders. */
  questionTemplate: string;
  active: boolean;
}

export const MARKET_GROUPS: Record<string, MarketGroupSpec> = {
  "btc-3m": {
    groupId: "btc-3m",
    assetSymbol: "BTC",
    category: "crypto",
    sortName: "BTC",
    resolutionKind: "pyth",
    pythFeedId: "",
    durationSec: 180,
    // Directional: strike == open price exactly (no bucket rounding).
    // close > strike → YES = price went up; close <= strike → NO.
    tickSize: 1n,
    poolDepth: 500_000_000n, // 500 vUSD at 1e6
    spawnCadence: "on-resolve",
    questionTemplate: "Will Bitcoin go up in the next 3 minutes?",
    active: true,
  },
  "eth-3m": {
    groupId: "eth-3m",
    assetSymbol: "ETH",
    category: "crypto",
    sortName: "ETH",
    resolutionKind: "pyth",
    pythFeedId: "",
    durationSec: 180,
    tickSize: 1n,
    poolDepth: 500_000_000n, // 500 vUSD at 1e6
    spawnCadence: "on-resolve",
    questionTemplate: "Will Ethereum go up in the next 3 minutes?",
    active: true,
  },
};

/** Set of active recurring group ids. Used by UI filters to exclude
 *  deprecated groups (e.g. zombie `btc-15m` rows from earlier cadence). */
export const ACTIVE_RECURRING_GROUP_IDS: ReadonlySet<string> = new Set(
  Object.values(MARKET_GROUPS)
    .filter((g) => g.active)
    .map((g) => g.groupId),
);

export function isActiveRecurringGroupId(id: string | null | undefined): boolean {
  return !!id && ACTIVE_RECURRING_GROUP_IDS.has(id);
}

export function activePythGroups(): MarketGroupSpec[] {
  return Object.values(MARKET_GROUPS).filter(
    (g) => g.active && g.resolutionKind === "pyth",
  );
}

export function activeGroupsByCadence(c: SpawnCadence): MarketGroupSpec[] {
  return Object.values(MARKET_GROUPS).filter(
    (g) => g.active && g.spawnCadence === c,
  );
}

export function groupById(id: string): MarketGroupSpec | undefined {
  return MARKET_GROUPS[id];
}

/**
 * Resolve the UI category for a market. Recurring markets derive their
 * category from the registry; standalone markets (rare after Slice 4) fall
 * back to "others". Kept here so UI and backend share one definition.
 */
export function categoryForRecurringGroupId(
  groupId: string | null | undefined,
): Category {
  if (!groupId) return "others";
  return MARKET_GROUPS[groupId]?.category ?? "others";
}

/**
 * Alphabetical sort key. Returns the registry `sortName` when the market is
 * recurring; otherwise falls back to the market's own question for stable
 * ordering.
 */
export function sortNameForRecurringGroupId(
  groupId: string | null | undefined,
): string | null {
  if (!groupId) return null;
  return MARKET_GROUPS[groupId]?.sortName ?? null;
}

/**
 * Lazy Pyth feed-id resolution by asset. Kept OUT of the registry literal so
 * importing this module never forces env validation (env getters in `./aptos`
 * throw on missing vars).
 */
export function pythFeedForGroup(spec: MarketGroupSpec): string {
  if (spec.resolutionKind !== "pyth") {
    throw new Error(`group ${spec.groupId} is not a pyth group`);
  }
  if (spec.assetSymbol === "BTC") return pythBtcFeedId();
  if (spec.assetSymbol === "ETH") return pythEthFeedId();
  throw new Error(`no pyth feed for asset ${spec.assetSymbol}`);
}

/** Format a Pyth 1e8 strike as `$XXX,XXX`. */
export function formatUSDStrike(strikePrice: bigint): string {
  const whole = Number(strikePrice / 100_000_000n);
  return `$${whole.toLocaleString("en-US")}`;
}

export function renderQuestion(
  spec: MarketGroupSpec,
  strikePrice: bigint,
  closeTimeSec: number,
): string {
  const hhmm = new Date(closeTimeSec * 1000).toISOString().slice(11, 16);
  return spec.questionTemplate
    .replace("{asset}", spec.assetSymbol)
    .replace("{strike}", formatUSDStrike(strikePrice))
    .replace("{closeTime}", hhmm);
}
