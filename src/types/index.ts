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

export interface UserPortfolio {
  address: string;
  balance: number;
  faucetClaimedAt: string | null;
  positions: PositionView[];
}

export interface PositionView {
  id: string;
  marketId: string;
  marketQuestion: string;
  marketState: string;
  side: "YES" | "NO";
  amountSpent: number;
  sharesReceived: number;
  avgPrice: number;
  currentPrice: number;
  currentValue: number;
  pnl: number;
  claimable: boolean;
  claimableAmount: number;
  resolvedOutcome: string | null;
  claimed: boolean;
}

export interface TradeResult {
  tradeId: string;
  side: "YES" | "NO";
  amountSpent: number;
  sharesReceived: number;
  priceAtTrade: number;
  newYesPrice: number;
  newNoPrice: number;
  newBalance: number;
}

export interface ClaimResult {
  claimId: string;
  payout: number;
  newBalance: number;
}

export interface LeaderboardEntry {
  rank: number;
  address: string;
  netWorth: number;
  profit: number;
  tradeCount: number;
}

export interface MarketsResponse {
  markets: MarketWithPrices[];
  total: number;
  limit: number;
  offset: number;
}
