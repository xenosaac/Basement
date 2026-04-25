/**
 * Basement v0.5 — Card / detail-page copy helpers.
 *
 * `recurringGroupId` is the canonical handle for the new product matrix
 * (sol-15m-strike-up, brent-1d-down, eco-cpi-mom-monthly, …). Parsing it lets
 * the UI render headlines without forcing every consumer to look up
 * MARKET_GROUPS or duplicate the question template — useful for ECO (which
 * lives in cases_v3 / series_v3, NOT in market-groups.ts) and as a fallback
 * for any registry-resolved spec.
 *
 * Pure module — no DB / env / server imports. Safe for client bundles.
 */

export type StrikeKind = "up" | "down" | "barrier";
export type Tenor = "3m" | "15m" | "1h" | "1d-noon" | "1d-4pm";

export interface ParsedCase {
  /** Canonical asset symbol uppercased ("SOL", "EURUSD"). Display formatting
   *  (e.g. "EUR/USD") is the headline renderer's job. */
  asset: string;
  tenor: Tenor;
  strikeKind: StrikeKind;
}

// ──────────────────────────────────────────────────────────
// Categories — case-copy's category enum is a SUPERSET of
// MARKET_GROUPS.Category, adding "macro" for ECO series which
// don't live in MARKET_GROUPS at all (they're in series_v3).
// ──────────────────────────────────────────────────────────

export type Category = "crypto" | "commodity" | "stocks" | "others" | "macro";

const COMMODITY_PREFIXES = ["xau-", "xag-", "xpt-", "brent-"] as const;
const CRYPTO_PREFIXES = [
  "btc-",
  "eth-",
  "sol-",
  "hype-",
  "matic-",
  "apt-",
] as const;
const STOCKS_PREFIXES = ["qqq-"] as const;
const FOREX_PREFIXES = ["eurusd-", "usdjpy-", "usdcnh-"] as const;
const MACRO_PREFIXES = ["eco-"] as const;

/**
 * Prefix-only fallback for `categoryForRecurringGroupId` when the group is
 * NOT in MARKET_GROUPS (e.g. ECO series, or future groups added before
 * registry sync). Returns "others" for unknown prefixes — same default as
 * the registry helper.
 */
export function categoryFromPrefix(
  groupId: string | null | undefined,
): Category {
  if (!groupId) return "others";
  const id = groupId.toLowerCase();
  if (MACRO_PREFIXES.some((p) => id.startsWith(p))) return "macro";
  if (COMMODITY_PREFIXES.some((p) => id.startsWith(p))) return "commodity";
  if (CRYPTO_PREFIXES.some((p) => id.startsWith(p))) return "crypto";
  if (STOCKS_PREFIXES.some((p) => id.startsWith(p))) return "stocks";
  if (FOREX_PREFIXES.some((p) => id.startsWith(p))) return "others";
  return "others";
}

// ──────────────────────────────────────────────────────────
// parseCase — recurringGroupId → asset/tenor/direction.
// ──────────────────────────────────────────────────────────

/** Multi-token forex assets are written `eurusd-…` / `usdjpy-…` / `usdcnh-…`
 *  and must be detected BEFORE the generic split('-')[0] path or they get
 *  lowercased as "eurusd" instead of mapped to "EURUSD" cleanly. */
const FOREX_ASSETS = new Set(["eurusd", "usdjpy", "usdcnh"]);

/** ECO series ids look like `eco-cpi-mom-monthly`, `eco-core-pce-monthly`,
 *  `eco-unemployment-monthly`, `eco-gdp-qoq-quarterly`. They don't have a
 *  rolling tenor — UI renders a "Releases <date>" countdown instead — so
 *  parseCase returns null and the headline path falls back to either the
 *  ECO template (in getCaseHeadline) or market.question. */
function isEcoGroupId(id: string): boolean {
  return id.startsWith("eco-");
}

function tenorFromGroupId(id: string): Tenor | null {
  if (id.includes("-3m-") || id.endsWith("-3m")) return "3m";
  if (id.includes("-15m-") || id.endsWith("-15m")) return "15m";
  if (id.includes("-1h-") || id.endsWith("-1h")) return "1h";
  if (id.includes("-1d-") || id.endsWith("-1d")) {
    // QQQ closes at NY 4pm ET; Brent / others at NY noon ET.
    if (id.startsWith("qqq-")) return "1d-4pm";
    return "1d-noon";
  }
  return null;
}

function strikeKindFromGroupId(id: string): StrikeKind | null {
  if (id.endsWith("-strike-up") || id.endsWith("-up")) return "up";
  if (id.endsWith("-strike-down") || id.endsWith("-down")) return "down";
  if (id.endsWith("-barrier")) return "barrier";
  return null;
}

function assetFromGroupId(id: string): string | null {
  // Forex: head IS the asset (eurusd, usdjpy, usdcnh).
  const head = id.split("-")[0];
  if (!head) return null;
  if (FOREX_ASSETS.has(head)) return head.toUpperCase();
  return head.toUpperCase();
}

/** Recognise common recurring groupId shapes. Returns null for ECO and any
 *  groupId we can't decompose — caller falls back to market.question. */
export function parseCase(
  groupId: string | null | undefined,
): ParsedCase | null {
  if (!groupId) return null;
  const id = groupId.toLowerCase();
  if (isEcoGroupId(id)) return null;

  const tenor = tenorFromGroupId(id);
  const strikeKind = strikeKindFromGroupId(id);
  const asset = assetFromGroupId(id);
  if (!tenor || !strikeKind || !asset) return null;
  return { asset, tenor, strikeKind };
}

// ──────────────────────────────────────────────────────────
// Display helpers
// ──────────────────────────────────────────────────────────

function tenorLabel(t: Tenor): string {
  switch (t) {
    case "3m":
      return "next 3 minutes";
    case "15m":
      return "next 15 minutes";
    case "1h":
      return "next 1 hour";
    case "1d-noon":
      return "by NY 12:00 ET close";
    case "1d-4pm":
      return "by NY 4:00 PM ET close";
  }
}

function displayAsset(asset: string): string {
  switch (asset.toUpperCase()) {
    case "EURUSD":
      return "EUR/USD";
    case "USDJPY":
      return "USD/JPY";
    case "USDCNH":
      return "USD/CNH";
    case "QQQ":
      return "NASDAQ100";
    default:
      return asset.toUpperCase();
  }
}

/** Format a USD value with locale separators + 2dp. Caller is expected to
 *  pass either a number or a numeric-coercible string; null/NaN → "$—". */
function formatUsd(value: number | string | null | undefined): string {
  if (value == null) return "$—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "$—";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a Pyth-style raw e8 price (1e-8 USD per integer step) as a USD
 * display string. Returns "$—" on null / unparseable input.
 *
 * Kept symmetric with `formatUsd` so caller doesn't need to know whether the
 * source is e8 or already-decoded.
 */
export function formatBarrierPriceFromE8(
  priceE8: bigint | string | null | undefined,
): string {
  if (priceE8 == null) return "$—";
  let n: bigint;
  try {
    n = typeof priceE8 === "bigint" ? priceE8 : BigInt(priceE8);
  } catch {
    return "$—";
  }
  // Integer-USD (n / 1e8) + fractional cents (((n % 1e8) / 1e6) cents).
  const SCALE = 100_000_000n;
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const intUsd = abs / SCALE;
  const fracE8 = abs % SCALE;
  // 2dp: round half-up at the cent boundary.
  const ROUND_HALF = 500_000n; // 0.5 cents in e8 → 5e5 e8 units = 1/2 cent at expo -8
  const cents = (fracE8 + ROUND_HALF) / 1_000_000n; // → integer 0..100
  let intStr = intUsd;
  let cents2 = cents;
  if (cents2 >= 100n) {
    intStr = intUsd + 1n;
    cents2 = 0n;
  }
  return `${sign}$${intStr.toLocaleString("en-US")}.${cents2
    .toString()
    .padStart(2, "0")}`;
}

// ──────────────────────────────────────────────────────────
// getCaseHeadline — card title.
// ──────────────────────────────────────────────────────────

interface CaseHeadlineInput {
  recurringGroupId?: string | null;
  question: string;
  /** USD-decimal strike price (markets.strike_price column). */
  strikePrice?: number | string | null;
  /** Pyth e8 lower barrier (cases_v3.barrier_low_price_e8). */
  barrierLowPriceE8?: bigint | string | null;
  /** Pyth e8 upper barrier (cases_v3.barrier_high_price_e8). */
  barrierHighPriceE8?: bigint | string | null;
}

export function getCaseHeadline(market: CaseHeadlineInput): string {
  const parsed = parseCase(market.recurringGroupId);
  if (!parsed) return market.question;

  const asset = displayAsset(parsed.asset);
  const tLabel = tenorLabel(parsed.tenor);

  if (parsed.strikeKind === "barrier") {
    if (market.barrierLowPriceE8 == null || market.barrierHighPriceE8 == null) {
      return market.question;
    }
    const low = formatBarrierPriceFromE8(market.barrierLowPriceE8);
    const high = formatBarrierPriceFromE8(market.barrierHighPriceE8);
    if (low === "$—" || high === "$—") return market.question;
    return `Will ${asset} break out of ${low} – ${high} in ${tLabel}?`;
  }

  if (market.strikePrice == null) return market.question;
  const strike = formatUsd(market.strikePrice);
  if (strike === "$—") return market.question;
  if (parsed.strikeKind === "up") {
    return `Will ${asset} break above ${strike} in ${tLabel}?`;
  }
  return `Will ${asset} break below ${strike} in ${tLabel}?`;
}

// ──────────────────────────────────────────────────────────
// ECO templates (v1 — wire when ECO list endpoint exists).
//
// Reference for v1: when the markets endpoint merges series_v3
// event_driven cases, dispatch on `series.eventType` here. Strikes for ECO
// are expressed in the market's native unit (% for CPI/PCE/UNRATE, $/% for
// GDP) — these are NOT derived percentages, they're the data's primary
// units (per feedback_no_percent_show_price.md the §"market-native unit"
// exception applies).
//
// export function getEcoHeadline(c: { eventType: string; strikePct: number;
//   periodLabel: string; lastPct: number | null }): { title: string; sub: string } {
//   switch (c.eventType) {
//     case "us_cpi_mom":
//       return {
//         title: `Will US prices rise faster than usual in ${c.periodLabel}?`,
//         sub: c.lastPct != null
//           ? `Last month: +${c.lastPct.toFixed(1)}%   ·   This bet: >${c.strikePct.toFixed(1)}%`
//           : `This bet: >${c.strikePct.toFixed(1)}%`,
//       };
//     case "us_core_pce":
//       return { title: `Will US core inflation come in above ${c.strikePct.toFixed(1)}% in ${c.periodLabel}?`, sub: "" };
//     case "us_unemployment":
//       return { title: `Will US unemployment tick up to ${c.strikePct.toFixed(1)}% in ${c.periodLabel}?`, sub: "" };
//     case "us_gdp_qoq":
//       return { title: `Will US economy grow by more than ${c.strikePct.toFixed(1)}% in ${c.periodLabel}?`, sub: "" };
//   }
// }
