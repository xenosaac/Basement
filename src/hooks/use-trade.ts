"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import type { TradeResult } from "@/types";
import { portfolioAddressQueryKey } from "./use-portfolio-query";

export function useTrade(marketId: string) {
  const queryClient = useQueryClient();
  const { account } = useWallet();
  const address = account?.address?.toString() ?? undefined;

  return useMutation<TradeResult, Error, { side: "YES" | "NO"; amount: number; direction?: "BUY" | "SELL" }>({
    mutationFn: async ({ side, amount, direction = "BUY" }) => {
      const res = await fetch(`/api/markets/${marketId}/trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side, amount, direction }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Trade failed");
      }
      return res.json();
    },
    onSuccess: () => {
      // Hot path: the market user just traded on + their portfolio — refetch.
      queryClient.invalidateQueries({ queryKey: ["market", marketId] });
      queryClient.invalidateQueries({ queryKey: portfolioAddressQueryKey(address) });
      // Cold path: the markets list. Mark stale so any mounted list re-fetches on next
      // window focus or navigation, but don't force a refetch right now (user is on detail page).
      queryClient.invalidateQueries({ queryKey: ["markets"], refetchType: "none" });
    },
  });
}
