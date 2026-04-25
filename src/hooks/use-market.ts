"use client";

import { useQuery } from "@tanstack/react-query";
import type { MarketWithPrices } from "@/types";

export function useMarket(id: string) {
  return useQuery<MarketWithPrices>({
    queryKey: ["market", id],
    queryFn: async () => {
      const res = await fetch(`/api/markets/${id}`);
      if (!res.ok) throw new Error("Failed to fetch market");
      return res.json();
    },
    enabled: !!id,
    // Poll while OPEN (live trading) and CLOSED (awaiting resolve). Stop
    // only once RESOLVED/SETTLED — those states are immutable.
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === "RESOLVED" || state === "SETTLED") return false;
      return state === "OPEN" ? 3_000 : 5_000;
    },
  });
}
