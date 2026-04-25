"use client";

import { useQuery } from "@tanstack/react-query";
import type { OrdersResponse } from "@/lib/types/v3-api";

export function useOrdersV3(address: string | undefined) {
  return useQuery<OrdersResponse>({
    queryKey: ["orders-v3", address ?? null],
    queryFn: async () => {
      const res = await fetch(`/api/orders?user=${address}`);
      if (!res.ok) throw new Error("Failed to fetch orders");
      return res.json();
    },
    enabled: !!address,
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}
