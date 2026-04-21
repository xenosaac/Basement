"use client";

import { useQuery } from "@tanstack/react-query";
import type { MarketWithPrices } from "@/types";

type MarketDetail = MarketWithPrices & {
  recentTrades: Array<{
    id: string;
    side: "YES" | "NO";
    amountSpent: number;
    sharesReceived: number;
    priceAtTrade: number;
    createdAt: string;
    userAddress: string;
  }>;
};

export function useMarket(id: string) {
  return useQuery<MarketDetail>({
    queryKey: ["market", id],
    queryFn: async () => {
      const res = await fetch(`/api/markets/${id}`);
      if (!res.ok) throw new Error("Failed to fetch market");
      return res.json();
    },
    enabled: !!id,
    // Only poll while the market is OPEN (trading live). Once CLOSED/RESOLVED/SETTLED,
    // data is immutable — stop polling. Saves ~15 of 18 requests per 3-min recurring round.
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "OPEN" ? 10_000 : false;
    },
  });
}
