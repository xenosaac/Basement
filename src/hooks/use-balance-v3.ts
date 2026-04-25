"use client";

import { useQuery } from "@tanstack/react-query";
import type { BalanceResponse } from "@/lib/types/v3-api";

export function useBalanceV3(address: string | undefined) {
  return useQuery<BalanceResponse>({
    queryKey: ["balance-v3", address ?? null],
    queryFn: async () => {
      const res = await fetch(`/api/balance?user=${address}`);
      if (!res.ok) throw new Error("Failed to fetch balance");
      return res.json();
    },
    enabled: !!address,
    staleTime: 3_000,
    refetchInterval: 5_000,
  });
}

export function balanceQueryKey(address?: string) {
  return ["balance-v3", address ?? null] as const;
}
