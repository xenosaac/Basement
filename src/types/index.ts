export interface MarketWithPrices {
  id: string;
  question: string;
  description: string;
  imageUrl: string | null;
  state: "OPEN" | "CLOSED" | "RESOLVED" | "SETTLED";
  yesPrice: number;
  noPrice: number;
  yesDemand: number;
  noDemand: number;
  closeTime: string | null;
  resolvedOutcome: string | null;
  slug: string;
  totalVolume: number;
  marketType?: "MIRRORED" | "RECURRING";
  asset?: string | null;
  strikePrice?: number | null;
  recurringGroupId?: string | null;
  caseId?: string | null;
  /** Lower barrier (Pyth e8 raw) for `barrier_two_sided` cases — joined from
   *  cases_v3. NULL on directional / legacy markets. Stringified bigint to
   *  avoid Number precision loss. */
  barrierLowPriceE8?: string | null;
  /** Upper barrier (Pyth e8 raw) for `barrier_two_sided` cases. */
  barrierHighPriceE8?: string | null;
}

export interface MarketsResponse {
  markets: MarketWithPrices[];
  total: number;
  limit: number;
  offset: number;
}

export interface LeaderboardEntry {
  rank: number;
  address: string;
  profit: number;
  tradeCount: number;
}
