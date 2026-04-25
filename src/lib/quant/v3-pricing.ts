/**
 * Basement v3 pricing module — pure functions for implied probability,
 * settlement display, and strike/live-price formatting.
 *
 * All inputs are stringified-bigint cents (wire format from @/lib/types/v3-api)
 * or raw `bigint`. All math stays in bigint until the final percent step to
 * avoid precision loss on large pools (10^15+ cents).
 *
 * No side effects, no React, no DB. SSR-safe.
 *
 * References:
 *   - B-pricing.md (sub-plan)
 *   - MASTER.md §2 decisions (D3 settlement, D8 resolving helper, D11 spark variant, D25 no LOCKED)
 *   - CLAUDE.md §4 "Settlement 显示精确 1.00 / 0"
 */
import type { CaseState, Outcome, SeriesSummary } from "@/lib/types/v3-api";
import {
  buy as pmBuy,
  sell as pmSell,
  priceYes as pmPriceYes,
  priceNo as pmPriceNo,
  initialReserves,
  isUninitialized,
} from "./pm-amm";

// ───────────────────── Constants ─────────────────────

/**
 * Settlement epsilon in cents. Default 0 means winner=100¢, loser=0¢
 * (parimutuel truth, per MASTER D3). Flip to 1 to render 99¢ / 1¢
 * Polymarket-style without touching any call site.
 */
export const V3_SETTLEMENT_EPSILON_CENTS = 0;

/**
 * Hysteresis band for sparkline variant (per MASTER D11 + REVIEW red-team #6).
 * Below this absolute difference the sparkline renders "neutral" to avoid
 * jittery color flips when live price hugs the strike.
 */
export const SPARKLINE_HYSTERESIS_CENTS = 5n;

// ───────────────────── Implied probability ─────────────────────

export interface ImpliedProbability {
  /** Cost of 1 UP share, 0..100 cents. Clamped to 1..99 while both sides have stake. */
  upCents: number;
  /** Cost of 1 DOWN share; always `100 - upCents`. */
  downCents: number;
  /** Integer percent 0..100 (identical to `upCents` here; kept for legibility). */
  upPct: number;
  /** Integer percent; `upPct + downPct === 100`. */
  downPct: number;
  /** Exactly one side has stake. */
  oneSided: boolean;
  /** Both sides are zero. */
  zeroTotal: boolean;
}

function clampCents(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/**
 * Crowd-certainty implied probability: P(UP) = upPool / totalPool. The side
 * with heavier stake is the market's consensus; its share costs more.
 *
 * Note: this is the Polymarket-style display semantic, not a raw parimutuel
 * inversion. At settlement the loser's share price IS zero because payout is
 * funded by the losers pool (parimutuel), but while LIVE we show the market's
 * belief, which is the fraction of stake backing that side.
 *
 * - zero-total pool      → 50 / 50 (`zeroTotal: true`)
 * - only UP has stake    → 99 / 1  (`oneSided: true`)  (market is "certain" UP)
 * - only DOWN has stake  → 1 / 99  (`oneSided: true`)
 * - both sides live      → clamp round(up/total * 100) to 1..99
 */
export function impliedProbability(
  upPoolCents: bigint,
  downPoolCents: bigint,
): ImpliedProbability {
  const up = upPoolCents < 0n ? 0n : upPoolCents;
  const down = downPoolCents < 0n ? 0n : downPoolCents;
  const total = up + down;

  if (total === 0n) {
    return {
      upCents: 50,
      downCents: 50,
      upPct: 50,
      downPct: 50,
      oneSided: false,
      zeroTotal: true,
    };
  }

  // Only DOWN has stake → crowd certain DOWN → upCents=1, downCents=99.
  if (up === 0n) {
    return {
      upCents: 1,
      downCents: 99,
      upPct: 1,
      downPct: 99,
      oneSided: true,
      zeroTotal: false,
    };
  }

  // Only UP has stake → crowd certain UP → upCents=99, downCents=1.
  if (down === 0n) {
    return {
      upCents: 99,
      downCents: 1,
      upPct: 99,
      downPct: 1,
      oneSided: true,
      zeroTotal: false,
    };
  }

  // Crowd certainty: P(UP) = up / total. Keep bigint until the last step.
  // Multiply to bps (basis points of 100) for 2-decimal rounding room,
  // then convert a single Number at the percent boundary.
  const bps = (up * 10_000n) / total;
  const rawUpPct = Number(bps) / 100; // 0..100 with 2 decimals of precision
  const upCents = clampCents(Math.round(rawUpPct), 1, 99);
  const downCents = 100 - upCents;

  return {
    upCents,
    downCents,
    upPct: upCents,
    downPct: downCents,
    oneSided: false,
    zeroTotal: false,
  };
}

// ───────────────────── Formatters ─────────────────────

/**
 * Format cents-per-share for UI.
 *   0   → "0¢"
 *   25  → "25¢"
 *   99  → "99¢"
 *   100 → "$1.00"   (winner settlement only)
 */
export function formatCentsShare(cents: number): string {
  if (!Number.isFinite(cents)) return "—";
  const rounded = Math.round(cents);
  if (rounded >= 100) return "$1.00";
  if (rounded <= 0) return "0¢";
  return `${rounded}¢`;
}

/** Format integer percent for UI — e.g. 50 → "50%". */
export function formatPercent(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  return `${Math.round(pct)}%`;
}

/**
 * Format cents as USD dollars. Accepts bigint / stringified bigint / null.
 *   null          → "—"
 *   7760103n      → "$77,601.03"
 *   "7760103"     → "$77,601.03"
 *   negative      → "-$XX.YY"
 */
export function formatUsdFromCents(cents: bigint | string | null): string {
  if (cents === null || cents === undefined) return "—";
  let b: bigint;
  try {
    b = typeof cents === "bigint" ? cents : BigInt(cents);
  } catch {
    return "—";
  }

  const negative = b < 0n;
  const abs = negative ? -b : b;
  const dollars = abs / 100n;
  const remainderCents = abs % 100n;
  const centsStr = remainderCents.toString().padStart(2, "0");

  // Insert thousands separators into the dollar part.
  const dollarStr = dollars.toString();
  const withCommas = dollarStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${negative ? "-" : ""}$${withCommas}.${centsStr}`;
}

// ───────────────────── Settlement display ─────────────────────

export interface V3DisplayPrices {
  upCents: number;
  downCents: number;
  upPct: number;
  downPct: number;
  phase: "LIVE" | "SETTLED" | "VOID";
}

/**
 * Settlement display per MASTER §2 decision table. Phases:
 *
 *   | caseState  | resolvedOutcome | upCents     | downCents   | phase    |
 *   |------------|-----------------|-------------|-------------|----------|
 *   | OPEN       | null            | implied     | implied     | LIVE     |
 *   | RESOLVED   | UP              | 100 - ε     | ε           | SETTLED  |
 *   | RESOLVED   | DOWN            | ε           | 100 - ε     | SETTLED  |
 *   | RESOLVED   | INVALID         | 50          | 50          | VOID     |
 *   | VOID       | any             | 50          | 50          | VOID     |
 *
 * D25: v3 cron writes OPEN → RESOLVED/VOID in one tx (tick/route.ts:296) —
 * the CLOSED row is dead code for v3 series_v3. Reserved for future phased
 * resolve; meanwhile `CLOSED + null` falls through to LIVE with frozen pools.
 */
export function v3SettlementDisplay(
  caseState: CaseState,
  upPoolCents: bigint,
  downPoolCents: bigint,
  resolvedOutcome: Outcome | null,
): V3DisplayPrices {
  if (caseState === "RESOLVED" && resolvedOutcome) {
    const eps = V3_SETTLEMENT_EPSILON_CENTS;

    if (resolvedOutcome === "INVALID") {
      return {
        upCents: 50,
        downCents: 50,
        upPct: 50,
        downPct: 50,
        phase: "VOID",
      };
    }

    const winnerCents = 100 - eps;
    const loserCents = eps;
    const upCents = resolvedOutcome === "UP" ? winnerCents : loserCents;
    const downCents = resolvedOutcome === "UP" ? loserCents : winnerCents;

    return {
      upCents,
      downCents,
      upPct: upCents,
      downPct: downCents,
      phase: "SETTLED",
    };
  }

  if (caseState === "VOID") {
    return {
      upCents: 50,
      downCents: 50,
      upPct: 50,
      downPct: 50,
      phase: "VOID",
    };
  }

  // OPEN, or defensive CLOSED-without-outcome fallthrough: show implied prob
  // on the (possibly frozen) pool. Per D25 this CLOSED path is reserved for
  // future phased resolve; today it should never trigger for v3 series_v3.
  const implied = impliedProbability(upPoolCents, downPoolCents);
  return {
    upCents: implied.upCents,
    downCents: implied.downCents,
    upPct: implied.upPct,
    downPct: implied.downPct,
    phase: "LIVE",
  };
}

// ───────────────────── Strike vs live price ─────────────────────

export interface StrikeVsLive {
  strikeDisplay: string;
  liveDisplay: string;
  /** Signed bigint cents delta (live - strike); null if either input missing. */
  deltaCents: bigint | null;
  /** Signed percent (2-decimal rounded at Number boundary); null if inputs missing or strike=0. */
  deltaPct: number | null;
  direction: "up" | "down" | "flat" | null;
}

function parseCentsOrNull(input: string | null): bigint | null {
  if (input === null || input === undefined) return null;
  try {
    return BigInt(input);
  } catch {
    return null;
  }
}

/**
 * Format strike vs live for the card/widget price block.
 * - null strike → `strikeDisplay="—"`, `deltaCents=null`
 * - null live   → `liveDisplay="—"`, `deltaCents=null`
 * - strike=0    → `deltaPct=null` (avoid division by zero)
 */
export function strikeVsLive(
  strikeCents: string | null,
  livePriceCents: string | null,
): StrikeVsLive {
  const strike = parseCentsOrNull(strikeCents);
  const live = parseCentsOrNull(livePriceCents);

  const strikeDisplay = strike === null ? "—" : formatUsdFromCents(strike);
  const liveDisplay = live === null ? "—" : formatUsdFromCents(live);

  if (strike === null || live === null) {
    return {
      strikeDisplay,
      liveDisplay,
      deltaCents: null,
      deltaPct: null,
      direction: null,
    };
  }

  const deltaCents = live - strike;

  let direction: "up" | "down" | "flat";
  if (deltaCents === 0n) direction = "flat";
  else if (deltaCents > 0n) direction = "up";
  else direction = "down";

  let deltaPct: number | null = null;
  if (strike !== 0n) {
    // Preserve sign and 2 decimals of precision via bps math.
    const signed = (deltaCents * 10_000n) / strike;
    deltaPct = Number(signed) / 100;
  }

  return {
    strikeDisplay,
    liveDisplay,
    deltaCents,
    deltaPct,
    direction,
  };
}

// ───────────────────── Sparkline variant ─────────────────────

function parseMaybeCents(input: string | bigint | null): bigint | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "bigint") return input;
  try {
    return BigInt(input);
  } catch {
    return null;
  }
}

/**
 * Decide sparkline accent from live-vs-strike with ±5¢ hysteresis (REVIEW #6).
 * - either input missing → "neutral"
 * - abs(live - strike) < 5 cents → "neutral"
 * - live > strike → "up"
 * - live < strike → "down"
 */
export function sparklineVariantFor(
  currentPriceCents: string | bigint | null,
  strikeCents: string | bigint | null,
): "up" | "down" | "neutral" {
  const live = parseMaybeCents(currentPriceCents);
  const strike = parseMaybeCents(strikeCents);
  if (live === null || strike === null) return "neutral";

  const diff = live - strike;
  const abs = diff < 0n ? -diff : diff;
  if (abs < SPARKLINE_HYSTERESIS_CENTS) return "neutral";
  return diff > 0n ? "up" : "down";
}

// ───────────────────── pm-AMM curve quotes ─────────────────────
//
// Wrappers around src/lib/pm-amm.ts (Paradigm pm-AMM) that translate
// between DB E8 units and pm-amm.ts share/dollar units.
//
//   sharesE8 (DB)  = shares × 1e8         (sub-cent precision)
//   cents    (DB)  = dollars × 100
//
// `casesV3.upSharesE8` and `downSharesE8` store pool RESERVES (x, y) of
// YES/NO outcome tokens — not user positions. User positions live in
// `positionsV3`.
//
// Buy:  pay `amountCents`, receive `sharesE8` of `side` at the marginal price.
// Sell: burn `sharesE8` of `side`, receive `proceedsCents`.
// Both functions return the new pool reserve state (newUpSharesE8,
// newDownSharesE8) for caller to persist.

export interface BuyQuote {
  sharesE8: bigint;
  avgPriceCents: number; // 0..100
  newUpSharesE8: bigint;
  newDownSharesE8: bigint;
  upPriceCentsAfter: number;
  downPriceCentsAfter: number;
}

export interface SellQuote {
  proceedsCents: bigint;
  pricePerShareCents: number; // 0..100
  newUpSharesE8: bigint;
  newDownSharesE8: bigint;
  upPriceCentsAfter: number;
  downPriceCentsAfter: number;
}

export interface CurvePrices {
  upCents: number;
  downCents: number;
}

function e8ToShares(b: bigint): number {
  return Number(b) / 1e8;
}

function sharesToE8(d: number): bigint {
  return BigInt(Math.max(0, Math.round(d * 1e8)));
}

function dollarsToCents(d: number): bigint {
  return BigInt(Math.max(0, Math.round(d * 100)));
}

function pmSideOf(side: "UP" | "DOWN"): "YES" | "NO" {
  return side === "UP" ? "YES" : "NO";
}

/** Convert E8 share count → integer cents at a fixed per-share price (0..100¢). */
export function sharesE8ToCents(
  sharesE8: bigint,
  pricePerShareCents: number,
): bigint {
  return (sharesE8 * BigInt(pricePerShareCents)) / 100_000_000n;
}

function readReserves(
  upSharesE8: bigint,
  downSharesE8: bigint,
): { x: number; y: number } {
  if (isUninitialized(Number(upSharesE8), Number(downSharesE8))) {
    return initialReserves();
  }
  return { x: e8ToShares(upSharesE8), y: e8ToShares(downSharesE8) };
}

/** Marginal prices given current pool reserves. */
export function curvePrices(
  upSharesE8: bigint,
  downSharesE8: bigint,
): CurvePrices {
  const { x, y } = readReserves(upSharesE8, downSharesE8);
  return {
    upCents: Math.round(pmPriceYes(x, y) * 100),
    downCents: Math.round(pmPriceNo(x, y) * 100),
  };
}

/** Quote a buy without persisting. Returns shares received + new pool state. */
export function quoteBuy(
  upSharesE8: bigint,
  downSharesE8: bigint,
  side: "UP" | "DOWN",
  amountCents: bigint,
): BuyQuote {
  if (amountCents <= 0n) {
    throw new Error("quoteBuy: amountCents must be positive");
  }
  const { x, y } = readReserves(upSharesE8, downSharesE8);
  const r = pmBuy(x, y, pmSideOf(side), Number(amountCents) / 100);
  return {
    sharesE8: sharesToE8(r.sharesBought),
    avgPriceCents: Math.round(r.avgPrice * 100),
    newUpSharesE8: sharesToE8(r.newX),
    newDownSharesE8: sharesToE8(r.newY),
    upPriceCentsAfter: Math.round(r.newPriceYes * 100),
    downPriceCentsAfter: Math.round(r.newPriceNo * 100),
  };
}

/** Quote a sell without persisting. Returns proceeds + new pool state. */
export function quoteSell(
  upSharesE8: bigint,
  downSharesE8: bigint,
  side: "UP" | "DOWN",
  sharesE8: bigint,
): SellQuote {
  if (sharesE8 <= 0n) {
    throw new Error("quoteSell: sharesE8 must be positive");
  }
  const { x, y } = readReserves(upSharesE8, downSharesE8);
  const r = pmSell(x, y, pmSideOf(side), Number(sharesE8) / 1e8);
  return {
    proceedsCents: dollarsToCents(r.proceeds),
    pricePerShareCents: Math.round(r.avgPrice * 100),
    newUpSharesE8: sharesToE8(r.newX),
    newDownSharesE8: sharesToE8(r.newY),
    upPriceCentsAfter: Math.round(r.newPriceYes * 100),
    downPriceCentsAfter: Math.round(r.newPriceNo * 100),
  };
}

// ───────────────────── Resolution helper ─────────────────────

export interface SeriesResolvingState {
  resolving: boolean;
  winnerSide: "UP" | "DOWN" | null;
}

/**
 * Signal "this round's close time has arrived and the cron may be mid-settle."
 *
 * Per MASTER D8 this lives in v3-pricing (no separate v3-resolution.ts).
 * Per sub-plan updated spec: tight window — `resolving` fires exactly at
 * `nowMs/1000 >= currentCloseTimeSec` with no grace buffer; the cron tick
 * latency is covered by how soon `currentResolvedOutcome` flips.
 *
 * `winnerSide` reflects `currentResolvedOutcome` once set:
 *   - "UP"   → winnerSide="UP"
 *   - "DOWN" → winnerSide="DOWN"
 *   - "INVALID" or null → winnerSide=null (no ring, or void styling upstream)
 */
export function isSeriesResolving(
  s: Pick<SeriesSummary, "currentCloseTimeSec" | "currentResolvedOutcome">,
  nowMs: number,
): SeriesResolvingState {
  const nowSec = Math.floor(nowMs / 1000);
  const resolving = nowSec >= s.currentCloseTimeSec;

  let winnerSide: "UP" | "DOWN" | null = null;
  if (s.currentResolvedOutcome === "UP") winnerSide = "UP";
  else if (s.currentResolvedOutcome === "DOWN") winnerSide = "DOWN";

  return { resolving, winnerSide };
}
