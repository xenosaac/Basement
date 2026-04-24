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
import { pythBtcFeedId, pythEthFeedId, pythXauFeedId } from "./aptos";

export type ResolutionKind = "pyth" | "switchboard" | "supra" | "manual" | "ucrt";
export type SpawnCadence =
  | "on-resolve"
  | "daily-00-utc"
  | "weekly-friday"
  | "manual";

/** UI-level asset class bucket. Drives the Crypto/Stocks/Commodity/Others tabs
 *  in market-grid.tsx. Declared here so the registry is the single source. */
export type Category = "crypto" | "stocks" | "commodity" | "others";

/** Move MarketType u8 constants. TS-side mirror so callers don't have to
 *  magic-number 0/1. The on-chain Move contract stores the byte as metadata
 *  and does NOT branch on it, so we can add new variants here without a
 *  Move upgrade. Names will be renamed in a future Move refactor. */
export const MARKET_TYPE_SPAWN_RECURRING_3MIN = 0;
export const MARKET_TYPE_DAILY_STRIKE = 1;

/** Threshold code stored in MarketConfig. YES = close compared to strike
 *  per this direction. */
export const THRESHOLD_ABOVE = 0;
export const THRESHOLD_BELOW = 1;

/** How the backend cron translates a group spec into a Move transaction.
 *  Config-driven: every consumer (spawn cron, DB row creator, question
 *  renderer) switches on `kind` — no `if (groupId === "xau-daily")`. */
export type SpawnStrategy =
  | { kind: "spawn_recurring_3min" }
  | {
      kind: "create_market";
      /** Where to anchor close_time. `daily-ny-midnight` = next 00:00 in
       *  `America/New_York` TZ, handles EDT/EST + DST boundaries. */
      closeAnchor: "daily-ny-midnight";
      /** Strike = openPriceRaw * (10000 + offsetBps) / 10000, then rounded
       *  to the spec's `displayTickRaw` via ceil (above) or floor (below). */
      strikeOffsetBps: number;
      thresholdType: typeof THRESHOLD_ABOVE | typeof THRESHOLD_BELOW;
      /** Expo of the Pyth feed this group uses. MUST match the feed's runtime
       *  `expo` — backend throws if `fetchPythPrice().expo !== pythExpo`. */
      pythExpo: number;
      /** TS-side market_type byte (see MARKET_TYPE_* above). */
      marketType: number;
      maxStalenessSec: number;
      feeBps: number;
      maxTradeBps: number;
    };

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
  /** Nominal round duration. For `spawn_recurring_3min` groups this is the
   *  on-chain hardcode (180s). For `create_market` groups it's ignored on
   *  chain (actual duration comes from closeAnchor → closeTime), kept here
   *  only for UI display fallbacks. */
  durationSec: number;
  /** Strike-rounding tick for UI display, in feed-raw units at `priceExpo`.
   *  XAU at expo -3: `1000n` = round to $1. BTC at expo -8: `50_000_000_000n`
   *  = round to $500. For `spawn_recurring_3min` directional mode use `1n`
   *  (strike == open price exactly). */
  tickSize: bigint;
  /** Pyth exponent for this group's price feed. Used to render / round
   *  strike values consistently across on-chain, DB, and UI. -8 for crypto,
   *  -3 for XAU. */
  priceExpo: number;
  /** Display-rounding tick in feed-raw units (see `tickSize` notes). Same
   *  numeric value as `tickSize` for strike-based specs; kept separate so
   *  future specs can round strike and display independently if needed. */
  displayTickRaw: bigint;
  /** AMM pool-seed vUSD at FA 1e6 decimals (500 vUSD = 500_000_000n). */
  poolDepth: bigint;
  spawnCadence: SpawnCadence;
  /** How the backend spawns this group on-chain. */
  spawnStrategy: SpawnStrategy;
  /** Supports `{asset}` `{strike}` `{closeTime}` `{closeTimeNy}` placeholders. */
  questionTemplate: string;
  /** True = included in UI, spawn cron, AND resolve cron. False = hidden
   *  everywhere by default. Use `legacyCleanupOnly` to keep resolve running
   *  on a group that's no longer active. */
  active: boolean;
  /** When `true`, resolve-onchain still processes lingering cases in this
   *  group (so they don't orphan), but spawn-recurring and the UI skip it.
   *  Used to retire a group after a product pivot without leaving cases
   *  stuck open. */
  legacyCleanupOnly?: boolean;
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
    priceExpo: -8,
    displayTickRaw: 1n,
    poolDepth: 500_000_000n, // 500 vUSD at 1e6
    spawnCadence: "on-resolve",
    spawnStrategy: { kind: "spawn_recurring_3min" },
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
    priceExpo: -8,
    displayTickRaw: 1n,
    poolDepth: 500_000_000n, // 500 vUSD at 1e6
    spawnCadence: "on-resolve",
    spawnStrategy: { kind: "spawn_recurring_3min" },
    questionTemplate: "Will Ethereum go up in the next 3 minutes?",
    active: true,
  },
  "xau-daily-up": {
    groupId: "xau-daily-up",
    assetSymbol: "XAU",
    category: "commodity",
    sortName: "XAU ↑",
    resolutionKind: "pyth",
    pythFeedId: "",
    // Nominal duration kept for UI; actual close comes from closeAnchor.
    durationSec: 86_400,
    tickSize: 1000n, // $1 at expo -3
    priceExpo: -3,
    displayTickRaw: 1000n,
    poolDepth: 500_000_000n,
    spawnCadence: "on-resolve",
    spawnStrategy: {
      kind: "create_market",
      closeAnchor: "daily-ny-midnight",
      strikeOffsetBps: 100, // +1.00%: open * 1.01, rounded up to $1
      thresholdType: THRESHOLD_ABOVE,
      pythExpo: -3,
      marketType: MARKET_TYPE_DAILY_STRIKE,
      maxStalenessSec: 300,
      feeBps: 200,
      maxTradeBps: 500,
    },
    questionTemplate:
      "Will Gold close above {strike} at the next New York midnight?",
    active: true,
  },
  "xau-daily-down": {
    groupId: "xau-daily-down",
    assetSymbol: "XAU",
    category: "commodity",
    sortName: "XAU ↓",
    resolutionKind: "pyth",
    pythFeedId: "",
    durationSec: 86_400,
    tickSize: 1000n,
    priceExpo: -3,
    displayTickRaw: 1000n,
    poolDepth: 500_000_000n,
    spawnCadence: "on-resolve",
    spawnStrategy: {
      kind: "create_market",
      closeAnchor: "daily-ny-midnight",
      strikeOffsetBps: -100, // -1.00%: open * 0.99, rounded down to $1
      thresholdType: THRESHOLD_BELOW,
      pythExpo: -3,
      marketType: MARKET_TYPE_DAILY_STRIKE,
      maxStalenessSec: 300,
      feeBps: 200,
      maxTradeBps: 500,
    },
    questionTemplate:
      "Will Gold close below {strike} at the next New York midnight?",
    active: true,
  },
  // Retired: the old single-sided 24h XAU group. Kept in the registry with
  // `active: false` + `legacyCleanupOnly: true` so any open cases in this
  // group still get resolved by the cron; UI and spawn skip it entirely.
  "xau-daily": {
    groupId: "xau-daily",
    assetSymbol: "XAU",
    category: "commodity",
    sortName: "XAU-legacy",
    resolutionKind: "pyth",
    pythFeedId: "",
    durationSec: 180, // matches the 3-min hardcode in the pre-1g Move path
    tickSize: 1n,
    priceExpo: -3,
    displayTickRaw: 1000n,
    poolDepth: 500_000_000n,
    spawnCadence: "on-resolve",
    spawnStrategy: { kind: "spawn_recurring_3min" },
    questionTemplate: "Will Gold's price be higher 24 hours from now?",
    active: false,
    legacyCleanupOnly: true,
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

/**
 * Groups that the resolve-onchain cron should still process. Includes
 * active groups AND legacy-cleanup groups — so we can retire a group
 * (active:false) without orphaning its last open case on chain. Spawn +
 * UI intentionally do NOT consult this set.
 */
export function resolvableGroupsByCadence(c: SpawnCadence): MarketGroupSpec[] {
  return Object.values(MARKET_GROUPS).filter(
    (g) => (g.active || g.legacyCleanupOnly) && g.spawnCadence === c,
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
  if (spec.assetSymbol === "XAU") return pythXauFeedId();
  throw new Error(`no pyth feed for asset ${spec.assetSymbol}`);
}

/**
 * Returns true when a given market group is tradeable RIGHT NOW.
 *
 * - **Crypto** markets trade 24/7.
 * - **Commodity** (currently XAU gold): Sun 22:00 UTC → Fri 21:00 UTC. Matches
 *   the LBMA + COMEX overlap window. Gold is stale on the weekend, so a 1-hour
 *   rolling market spawned there would resolve on a flat price — we just skip.
 * - **Stocks** (Phase 2): always false for now.
 * - **Others** (politics/events — Phase 2): manual, not spawn-gated here.
 *
 * @param nowUtcSec — Unix-seconds timestamp; pass `Date.now()/1000` in production.
 *                    Exposed as a parameter so tests can pin time.
 */
export function isMarketOpen(
  spec: MarketGroupSpec,
  nowUtcSec: number,
): boolean {
  if (spec.category === "crypto") return true;

  if (spec.category === "commodity") {
    const d = new Date(nowUtcSec * 1000);
    const dow = d.getUTCDay(); // 0=Sun, 6=Sat
    const hour = d.getUTCHours();
    if (dow === 6) return false; // Sat, fully closed
    if (dow === 0 && hour < 22) return false; // Sun before 22:00 UTC open
    if (dow === 5 && hour >= 21) return false; // Fri 21:00 UTC and after
    return true;
  }

  if (spec.category === "stocks") return false; // Phase 2 will open this
  return false; // "others" — not spawn-scheduled
}

/**
 * Format a raw Pyth strike (integer at `expo`) as a display USD string.
 * `expo` is negative (e.g. -8 for crypto, -3 for XAU). Optional
 * `maximumFractionDigits` (default 2). Keeps the `$` prefix + locale
 * thousand-separators.
 */
export function formatUsdFromRaw(
  raw: bigint,
  expo: number,
  opts: { maximumFractionDigits?: number } = {},
): string {
  const maxFrac = opts.maximumFractionDigits ?? 2;
  const scale = Math.pow(10, -expo); // expo=-3 → 1000
  // Split raw into integer + fractional parts using BigInt math, then join.
  const sign = raw < 0n ? "-" : "";
  const abs = raw < 0n ? -raw : raw;
  const intPart = abs / BigInt(scale);
  const fracPart = abs % BigInt(scale);
  const intStr = intPart.toLocaleString("en-US");
  if (maxFrac === 0 || fracPart === 0n) {
    return `${sign}$${intStr}`;
  }
  // Pad fractional to full width, then trim trailing zeros up to maxFrac.
  const fracStr = fracPart
    .toString()
    .padStart(String(scale).length - 1, "0");
  const trimmed = fracStr.slice(0, maxFrac).replace(/0+$/, "");
  return trimmed.length > 0 ? `${sign}$${intStr}.${trimmed}` : `${sign}$${intStr}`;
}

/** @deprecated Use {@link formatUsdFromRaw} which takes an explicit expo;
 *  this thin wrapper preserves the old 1e8-crypto-specific behaviour for
 *  any caller that still assumes it. Remove after call sites migrate. */
export function formatUSDStrike(strikePrice: bigint): string {
  return formatUsdFromRaw(strikePrice, -8, { maximumFractionDigits: 0 });
}

/**
 * Return the Unix seconds of the NEXT `00:00:00 America/New_York`. Handles
 * DST transitions (EDT/EST) correctly by querying the TZ offset for the
 * target wall-clock moment via {@link Intl.DateTimeFormat}. If the current
 * instant happens to be exactly 00:00 NY, this still advances to the next
 * day's midnight — callers want "the next anchor", not the current one.
 */
export function nextNyMidnightUtc(nowUtcSec: number): number {
  const now = new Date(nowUtcSec * 1000);
  // 1. Get the CURRENT NY wall-clock date so we know which day we are in.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const nyYear = Number(get("year"));
  const nyMonth = Number(get("month"));
  const nyDay = Number(get("day"));
  // 2. Target = tomorrow's NY calendar date at 00:00:00.
  const tomorrow = new Date(Date.UTC(nyYear, nyMonth - 1, nyDay + 1));
  const tY = tomorrow.getUTCFullYear();
  const tM = tomorrow.getUTCMonth();
  const tD = tomorrow.getUTCDate();
  // 3. Convert that wall-clock moment back to UTC. Start with a provisional
  // UTC anchor (00:00 UTC on target date) + query its NY offset; target =
  // anchor − offset. US DST transitions happen at 06:00–07:00 UTC, strictly
  // after 00:00 UTC and after target midnight NY (04:00/05:00 UTC), so the
  // offset measured at 00:00 UTC is the same as at target midnight NY — a
  // single iteration gets it right without boundary cases.
  const anchor = Date.UTC(tY, tM, tD, 0, 0, 0);
  const offsetMin = getTimeZoneOffsetMinutes("America/New_York", anchor);
  const targetMs = anchor - offsetMin * 60_000;
  return Math.floor(targetMs / 1000);
}

/**
 * Returns the offset in MINUTES (signed) such that
 * `utcLocalWallClockMs = utcMs + offsetMin * 60_000` renders the same
 * wall-clock time in the given timezone. For `America/New_York`:
 *   EDT (summer) → -240
 *   EST (winter) → -300
 */
export function getTimeZoneOffsetMinutes(
  timeZone: string,
  utcMs: number,
): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const y = Number(get("year"));
  const mo = Number(get("month")) - 1;
  const d = Number(get("day"));
  let h = Number(get("hour"));
  if (h === 24) h = 0;
  const mi = Number(get("minute"));
  const s = Number(get("second"));
  const walledMs = Date.UTC(y, mo, d, h, mi, s);
  return (walledMs - utcMs) / 60_000;
}

/** Human date label for a NY-midnight close time. Format "Apr 24" in en-US. */
export function formatNyDateLabel(closeTimeUtcSec: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  }).format(new Date(closeTimeUtcSec * 1000));
}

/**
 * Canonical strike / closeTime / question derivation. **Every consumer**
 * (spawn cron, DB row creator, UI fallback) MUST call this; do not re-derive
 * these values elsewhere. Keeps DB and chain in lockstep.
 */
export interface DerivedMarketParams {
  /** Raw strike at the feed's expo — sent to Move `create_market.strike_price`. */
  strikeRaw: bigint;
  /** Display float for UI + DB `strike_price` column. */
  strikeDisplay: number;
  /** Unix seconds — sent to Move `create_market.close_time`. */
  closeTime: number;
  /** Seconds between spawn (`now`) and `closeTime`. Sent as
   *  `recurring_duration_seconds`; also drives DB `closeTime` for the row. */
  durationSec: number;
  /** Move threshold_type byte (0 above, 1 below). */
  thresholdType: 0 | 1;
  /** Rendered via {@link renderQuestion} on the spec's template. */
  question: string;
}

export function deriveMarketParams(
  spec: MarketGroupSpec,
  priceRaw: bigint,
  priceExpo: number,
  nowUtcSec: number,
): DerivedMarketParams {
  if (priceExpo !== spec.priceExpo) {
    throw new Error(
      `[deriveMarketParams] expo mismatch for ${spec.groupId}: ` +
        `feed returned ${priceExpo}, spec declares ${spec.priceExpo}`,
    );
  }

  const strategy = spec.spawnStrategy;

  if (strategy.kind === "spawn_recurring_3min") {
    // Directional: strike == open exactly (spec.tickSize = 1 by convention).
    // Close = now + 180 (matches on-chain hardcode). No bps offset.
    const closeTime = nowUtcSec + 180;
    const question = renderQuestion(spec, priceRaw, closeTime);
    return {
      strikeRaw: priceRaw,
      strikeDisplay: Number(priceRaw) * Math.pow(10, spec.priceExpo),
      closeTime,
      durationSec: 180,
      thresholdType: 0, // matches Move `spawn_recurring_3min` hardcode (ABOVE)
      question,
    };
  }

  // create_market path. Compute offset + tick-round per direction.
  const bps = BigInt(strategy.strikeOffsetBps);
  const numerator = priceRaw * (10_000n + bps);
  const unrounded = numerator / 10_000n; // integer division, truncates toward zero
  // Round to displayTickRaw: up for +bps (keeps strike ≥ target), down for -bps.
  const tick = spec.displayTickRaw > 0n ? spec.displayTickRaw : 1n;
  let strikeRaw: bigint;
  if (bps >= 0n) {
    // ceil(unrounded / tick) * tick
    strikeRaw = ((unrounded + tick - 1n) / tick) * tick;
  } else {
    // floor(unrounded / tick) * tick
    strikeRaw = (unrounded / tick) * tick;
  }

  let closeTime: number;
  if (strategy.closeAnchor === "daily-ny-midnight") {
    closeTime = nextNyMidnightUtc(nowUtcSec);
  } else {
    throw new Error(
      `[deriveMarketParams] unknown closeAnchor ${String(
        (strategy as { closeAnchor?: string }).closeAnchor,
      )}`,
    );
  }

  const question = renderQuestion(spec, strikeRaw, closeTime);
  return {
    strikeRaw,
    strikeDisplay: Number(strikeRaw) * Math.pow(10, spec.priceExpo),
    closeTime,
    durationSec: Math.max(0, closeTime - nowUtcSec),
    thresholdType: strategy.thresholdType,
    question,
  };
}

/**
 * Render a group's question template. Supports:
 *   {asset}       — spec.assetSymbol ("Bitcoin" / "Ethereum" / "Gold" prose
 *                    handled by callers if needed; registry templates already
 *                    use the prose name directly)
 *   {strike}      — formatUsdFromRaw(strikeRaw, spec.priceExpo)
 *   {closeTime}   — UTC HH:MM slice (3-min recurring, less useful with NY
 *                    anchor — use {closeTimeNy})
 *   {closeTimeNy} — "Apr 24 00:00 NY" — for NY-midnight anchored markets
 */
export function renderQuestion(
  spec: MarketGroupSpec,
  strikeRaw: bigint,
  closeTimeSec: number,
): string {
  const hhmm = new Date(closeTimeSec * 1000).toISOString().slice(11, 16);
  const nyLabel = `${formatNyDateLabel(closeTimeSec)} 00:00 NY`;
  return spec.questionTemplate
    .replace("{asset}", spec.assetSymbol)
    .replace("{strike}", formatUsdFromRaw(strikeRaw, spec.priceExpo))
    .replace("{closeTime}", hhmm)
    .replace("{closeTimeNy}", nyLabel);
}
