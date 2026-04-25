"use client";

import { useQuery } from "@tanstack/react-query";
import type { PositionsResponse } from "@/lib/types/v3-api";

const POLL_MS = 4_000;

export function usePositionsV3(userAddress: string | undefined) {
  return useQuery<PositionsResponse>({
    queryKey: ["positions-v3", userAddress],
    queryFn: async () => {
      const res = await fetch(`/api/positions?user=${userAddress}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`positions failed (${res.status})`);
      return res.json();
    },
    enabled: Boolean(userAddress),
    refetchInterval: POLL_MS,
    staleTime: POLL_MS / 2,
    refetchOnWindowFocus: true,
  });
}
