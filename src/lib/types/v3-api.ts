/**
 * Basement v3 Web2 API contract — shared types consumed by frontend hooks,
 * API route handlers, and internal engine.
 *
 * All monetary values in this API are `bigint`-serializable integers in CENTS
 * (1 USDC = 100 cents). Serialized as strings in JSON to avoid JS Number
 * precision loss; convert at the boundary.
 *
 * Authoritative file — frontend and backend both import from here.
 */

// ─── Series ───────────────────────────────────────────────

export type SeriesId =
  | "btc-usdc-3m"
  | "eth-usdc-3m"
  | "sol-usdc-3m"
  | "xau-usdc-1h"
  | "xag-usdc-1h"
  | "us500-usdc-1h"
  | "hype-usdc-1h";

export type SeriesCategory =
  | "quick_play"
  | "commodity"
  | "stocks"
  | "crypto_ext";

export interface SeriesStatic {
  seriesId: SeriesId;
  assetSymbol: string; // "BTC", "ETH", "SOL", "XAU", "XAG", "US500", "HYPE"
  pair: string; // e.g. "BTC/USDC"
  category: SeriesCategory;
  cadenceSec: number; // 180 or 3600
  pythFeedId: string; // hex, no 0x prefix (feeds listed in series-config.ts)
  marketHoursGated: boolean; // true for US500
  sortOrder: number; // UI display order within category
}

export interface SeriesSummary extends SeriesStatic {
  currentRoundIdx: number;
  currentStartTimeSec: number;
  currentCloseTimeSec: number;
  currentStrikeCents: string | null; // stringified bigint; null if not set yet
  currentUpPoolCents: string; // legacy parimutuel total stake (analytics only)
  currentDownPoolCents: string;
  currentUpPriceCents: number; // 0..100 — pm-AMM marginal YES price
  currentDownPriceCents: number; // 0..100 — pm-AMM marginal NO price
  currentPriceCents: string | null; // live Pyth price (from price_ticks / Hermes)
  /** Resolved outcome of the *current* round if the cron has settled it.
   *  Stays null while round is OPEN (and before tick processes resolution).
   *  Used by UI to render winner/loser display once SETTLED. */
  currentResolvedOutcome: Outcome | null;
  marketHours: {
    open: boolean;
    reason?: "weekend" | "holiday" | "pre-open" | "post-close";
  };
}

export interface SeriesListResponse {
  series: SeriesSummary[];
}

// ─── Sparkline (price ticks history) ─────────────────────

export interface SeriesTick {
  /** Unix seconds when Pyth published this price */
  tSec: number;
  /** Stringified bigint cents (1 USDC = 100 cents) */
  priceCents: string;
}

export interface SeriesTicksResponse {
  windowSec: number;
  ticks: Partial<Record<SeriesId, SeriesTick[]>>; // sorted ASC by tSec, ≤ limit per series
}

// ─── Cases (rounds) ────────────────────────────────────────

export type CaseState = "OPEN" | "CLOSED" | "RESOLVED" | "VOID";
export type Outcome = "UP" | "DOWN" | "INVALID";
export type BetSide = "UP" | "DOWN";

export interface CaseSummary {
  seriesId: SeriesId;
  roundIdx: number;
  startTimeSec: number;
  closeTimeSec: number;
  strikeCents: string | null;
  upPoolCents: string;
  downPoolCents: string;
  state: CaseState;
  resolvedOutcome: Outcome | null;
  resolvedPriceCents: string | null;
}

export interface CaseListResponse {
  cases: CaseSummary[];
  hasMore: boolean;
}

export interface MyPositionInRound {
  upCents: string; // stake on UP
  downCents: string; // stake on DOWN
  projectedPayoutCents: string | null; // null if not resolved; undefined if no win
  claimable: boolean; // true when resolved AND user won AND not yet credited
}

export interface RoundDetailResponse {
  case: CaseSummary;
  myPosition: MyPositionInRound | null; // null if ?user= not given or no position
}

// ─── Balance ───────────────────────────────────────────────

export interface BalanceResponse {
  userAddress: string;
  availableCents: string; // stringified bigint
  lockedCents: string; // locked in open bets
  totalDepositsCents: string; // lifetime faucet claims
  totalWithdrawalsCents: string; // zero for v3 (no real withdrawal in Session 1)
  nextFaucetAtSec: number | null; // unix seconds when next faucet claim is available; null = available now
}

// ─── Orders ────────────────────────────────────────────────

export interface OrderRow {
  orderId: string; // uuid
  userAddress: string;
  seriesId: SeriesId;
  roundIdx: number;
  side: BetSide;
  /** For buys: stake spent. For sells: proceeds received. */
  amountCents: string;
  /** Shares delta for this order (E8). null on legacy parimutuel rows. */
  sharesE8: string | null;
  /** 1 = buy, 0 = sell. */
  isBuy: 0 | 1;
  placedAtSec: number;
  caseState: CaseState;
  resolvedOutcome: Outcome | null;
  payoutCents: string | null; // final payout if resolved (winner); null otherwise
}

export interface OrdersResponse {
  orders: OrderRow[];
  hasMore: boolean;
}

// ─── Bet ──────────────────────────────────────────────────

export interface BetRequest {
  seriesId: SeriesId;
  roundIdx: number;
  side: BetSide;
  amountCents: number; // must be >= 10 (min $0.10)
  nonce: string; // uuid v4
  timestamp: number; // unix ms
  // Aptos wallet signature bundle
  signature: string; // hex or base64; backend accepts both
  fullMessage: string; // message that was signed (Aptos wallet wraps the inner payload)
  publicKey: string; // hex of the signing account's ed25519 public key
  address: string; // 0x-prefixed Aptos address (must match publicKey)
}

export interface BetResponse {
  orderId: string;
  acceptedAtSec: number;
  newAvailableCents: string;
  // Legacy parimutuel pool totals (still updated for analytics).
  upPoolAfterCents: string;
  downPoolAfterCents: string;
  // pm-AMM curve fields
  sharesE8: string; // shares received this trade
  avgPriceCents: number; // 0..100
  upPriceCentsAfter: number; // marginal UP price after the trade
  downPriceCentsAfter: number;
  upSharesAfterE8: string; // pool reserve x post-trade
  downSharesAfterE8: string; // pool reserve y post-trade
}

export interface SellRequest {
  seriesId: string;
  roundIdx: number;
  side: "UP" | "DOWN";
  sharesE8: string; // stringified bigint
  nonce: string;
}

export interface SellResponse {
  orderId: string;
  acceptedAtSec: number;
  newAvailableCents: string;
  proceedsCents: string;
  pricePerShareCents: number;
  upPriceCentsAfter: number;
  downPriceCentsAfter: number;
  upSharesAfterE8: string;
  downSharesAfterE8: string;
  // Remaining position after this sell (0 if fully closed)
  remainingSharesE8: string;
  realizedPnlCents: string; // signed
}

export interface QuoteResponse {
  seriesId: string;
  roundIdx: number;
  // Marginal prices at the current pool state
  upCents: number;
  downCents: number;
  // Optional buy quote (when amountCents is provided)
  buy: {
    sharesE8: string;
    avgPriceCents: number;
    upPriceCentsAfter: number;
    downPriceCentsAfter: number;
  } | null;
  // Optional sell quote (when sharesE8 is provided)
  sell: {
    proceedsCents: string;
    pricePerShareCents: number;
    upPriceCentsAfter: number;
    downPriceCentsAfter: number;
  } | null;
}

export interface PositionRow {
  seriesId: string;
  roundIdx: number;
  side: "UP" | "DOWN";
  sharesE8: string;
  costBasisCents: string;
  realizedPnlCents: string;
  // Live mark-to-market value if round still OPEN
  markValueCents: string | null;
  unrealizedPnlCents: string | null;
  /** ISO timestamp when user claimed this winning position (null = unclaimed). */
  claimedAt: string | null;
  /** Display state. */
  status: "OPEN" | "CLAIMABLE" | "CLAIMED" | "LOST";
  /** Total payout if status=CLAIMABLE (cost basis + realized P&L). */
  claimableCents: string | null;
}

export interface PositionsResponse {
  positions: PositionRow[];
  totalMarkValueCents: string;
  totalRealizedPnlCents: string;
}

// ─── Faucet ───────────────────────────────────────────────

export interface FaucetRequest {
  nonce: string;
  timestamp: number;
  signature: string;
  fullMessage: string;
  publicKey: string;
  address: string;
}

export interface FaucetResponse {
  creditedCents: string; // "5000" = $50.00
  newAvailableCents: string;
  nextClaimAtSec: number;
}

// ─── Leaderboard ──────────────────────────────────────────

export interface LeaderboardRow {
  rank: number;
  userAddress: string;
  realizedPnlCents: string; // can be negative — encode as stringified signed bigint
  tradeCount: number;
}

export interface LeaderboardResponse {
  rows: LeaderboardRow[];
  windowLabel: "24h" | "7d" | "all";
}

// ─── Errors ───────────────────────────────────────────────

export type ApiErrorCode =
  | "INSUFFICIENT_BALANCE"
  | "BET_TOO_SMALL"
  | "BET_TOO_LARGE"
  | "ROUND_CLOSED"
  | "ROUND_NOT_FOUND"
  | "SERIES_NOT_FOUND"
  | "MARKET_CLOSED" // NYSE hours gate
  | "INVALID_SIGNATURE"
  | "EXPIRED_NONCE"
  | "DUPLICATE_NONCE"
  | "FAUCET_COOLDOWN"
  | "WALLET_NOT_CONNECTED"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "BAD_REQUEST"
  | "INTERNAL";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  detail?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: ApiError;
}

// ─── Signature payload format (frontend <-> backend contract) ───
// Frontend constructs payload, serializes with sorted keys, wallet signs.
// Backend verifies signature matches publicKey + payload.

export interface SignedPayloadBase {
  action: "bet" | "faucet_claim";
  address: string;
  nonce: string;
  timestamp: number;
}

export interface BetSignedPayload extends SignedPayloadBase {
  action: "bet";
  seriesId: SeriesId;
  roundIdx: number;
  side: BetSide;
  amountCents: number;
}

export interface FaucetSignedPayload extends SignedPayloadBase {
  action: "faucet_claim";
}

export type SignedPayload = BetSignedPayload | FaucetSignedPayload;

/** Deterministic canonical JSON: sorted keys, no extra whitespace. */
export function canonicalizeSignedPayload(payload: SignedPayload): string {
  const indexed = payload as unknown as Record<string, unknown>;
  const keys = Object.keys(indexed).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = indexed[k];
  return JSON.stringify(sorted);
}
