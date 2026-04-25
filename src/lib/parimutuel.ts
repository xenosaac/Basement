/**
 * Basement v3 parimutuel payout engine — pure functions, no side effects.
 *
 * Model:
 *   - Each case has two pools: UP and DOWN (total amounts in cents)
 *   - Losers' pool is distributed to winners pro-rata (by stake)
 *   - Platform takes fee_bps from losers' pool (not winners' stakes)
 *   - Winner always gets at least their stake back
 *   - Edge cases:
 *     - No winners (zero pool on winning side): refund all to losers' stakes
 *     - INVALID outcome: refund both sides at 1:1
 *     - One-sided pool (only UP or only DOWN bets): refund all
 */

export type Outcome = "UP" | "DOWN" | "INVALID";

export interface PayoutResult {
  /** cents credited back to each individual stake on the winning side.
   *  stake + share of losers' net (after fee). */
  winnerPayouts: Map<string /* orderId */, bigint>;
  /** cents credited back to each individual stake on the losing side.
   *  Usually 0, except INVALID or one-sided. */
  loserPayouts: Map<string, bigint>;
  /** platform fee collected (not redistributed) */
  platformFeeCents: bigint;
}

export interface OrderInput {
  orderId: string;
  side: "UP" | "DOWN";
  amountCents: bigint;
}

export interface SettleInput {
  orders: OrderInput[];
  upPoolTotal: bigint;
  downPoolTotal: bigint;
  outcome: Outcome;
  feeBps: number; // e.g. 200 for 2%
}

export function settleCase(input: SettleInput): PayoutResult {
  const { orders, upPoolTotal, downPoolTotal, outcome, feeBps } = input;
  const winnerPayouts = new Map<string, bigint>();
  const loserPayouts = new Map<string, bigint>();

  // Full refund scenarios
  if (
    outcome === "INVALID" ||
    upPoolTotal === 0n ||
    downPoolTotal === 0n
  ) {
    for (const o of orders) {
      if (o.side === "UP" || o.side === "DOWN") {
        loserPayouts.set(o.orderId, o.amountCents);
      }
    }
    return {
      winnerPayouts: new Map(),
      loserPayouts,
      platformFeeCents: 0n,
    };
  }

  const winningSide = outcome; // "UP" or "DOWN"
  const winningPool = winningSide === "UP" ? upPoolTotal : downPoolTotal;
  const losingPool = winningSide === "UP" ? downPoolTotal : upPoolTotal;

  // Platform fee from losing pool only
  const platformFeeCents = (losingPool * BigInt(feeBps)) / 10_000n;
  const distributablePool = losingPool - platformFeeCents;

  // Winners get stake back + pro-rata share of distributable
  for (const o of orders) {
    if (o.side === winningSide) {
      // payout = stake + (stake / winningPool) * distributablePool
      const bonus = (o.amountCents * distributablePool) / winningPool;
      winnerPayouts.set(o.orderId, o.amountCents + bonus);
    } else {
      // Losers get nothing (their stake is already in the vault, now
      // redistributed). Explicit 0 for clarity.
      loserPayouts.set(o.orderId, 0n);
    }
  }

  return { winnerPayouts, loserPayouts, platformFeeCents };
}

/** Compute outcome from strike + close price. Simple threshold:
 *  close > strike → UP, close < strike → DOWN, close == strike → INVALID (rare). */
export function computeOutcome(
  strikeE8: bigint,
  closeE8: bigint,
): Outcome {
  if (closeE8 > strikeE8) return "UP";
  if (closeE8 < strikeE8) return "DOWN";
  return "INVALID";
}
