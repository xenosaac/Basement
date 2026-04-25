/**
 * Market-maker engine — Basement v0.5 Phase B (stub).
 *
 * v0 ships pure pm-AMM with no rebalancing or skew detection — LP loss is
 * bounded by L·ln(2) ≈ $69 and the team eats it. v1+ will add:
 *
 *   - rebalanceL: dynamic L_t per Paradigm §3 (deeper liquidity early, taper
 *     near close so LVR stays constant across the round).
 *   - detectSkew: alarm when reserve imbalance crosses calibrated threshold
 *     (suggesting toxic flow or one-sided sentiment shock).
 *   - computeQuoteOffset: nudge YES/NO marginal prices in basis points to
 *     compensate for skew or upcoming macro events.
 *
 * Interfaces are stable so Phase D cron can wire `if (mm) mm.X(...)` once
 * implementations exist; calling any method today throws.
 */

export interface MarketMakerSnapshot {
  seriesId: string;
  caseId: string;
  upPoolE8: bigint;
  downPoolE8: bigint;
  currentL: number;
  sigmaAnnual: number;
  asOfSec: number;
}

export interface RebalanceDecision {
  newL: number;
  reason: string;
  changedBps: number;
}

export interface SkewSignal {
  skewBps: number;
  severity: "ok" | "warn" | "alarm";
}

export interface QuoteOffset {
  upBpsAdj: number;
  downBpsAdj: number;
}

export class MarketMaker {
  rebalanceL(_s: MarketMakerSnapshot): RebalanceDecision {
    throw new Error("MarketMaker.rebalanceL: not implemented (v1)");
  }
  detectSkew(_s: MarketMakerSnapshot): SkewSignal {
    throw new Error("MarketMaker.detectSkew: not implemented (v2)");
  }
  computeQuoteOffset(_s: MarketMakerSnapshot): QuoteOffset {
    throw new Error("MarketMaker.computeQuoteOffset: not implemented (v3)");
  }
}
