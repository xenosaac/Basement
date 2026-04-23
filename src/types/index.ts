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
}

export interface MarketsResponse {
  markets: MarketWithPrices[];
  total: number;
  limit: number;
  offset: number;
}
