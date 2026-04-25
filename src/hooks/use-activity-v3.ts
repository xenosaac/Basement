"use client";

import { useQuery } from "@tanstack/react-query";

export interface ActivityTrade {
  orderId: string;
  anonAddress: string;
  side: "UP" | "DOWN";
  isBuy: number;
  amountCents: string;
  sharesE8: string | null;
  placedAtSec: number;
}

export interface ActivityResponse {
  seriesId: string;
  roundIdx: number;
  trades: ActivityTrade[];
}

const POLL_MS = 4_000;

export function useActivityV3(
  seriesId: string | undefined,
  roundIdx: number | undefined,
  limit = 20,
) {
  return useQuery<ActivityResponse>({
    queryKey: ["activity-v3", seriesId, roundIdx, limit],
    queryFn: async () => {
      const sp = new URLSearchParams({
        seriesId: String(seriesId),
        roundIdx: String(roundIdx),
        limit: String(limit),
      });
      const res = await fetch(`/api/activity?${sp.toString()}`);
      if (!res.ok) throw new Error(`activity failed (${res.status})`);
      return res.json();
    },
    enabled: Boolean(seriesId && roundIdx !== undefined),
    refetchInterval: POLL_MS,
    staleTime: POLL_MS / 2,
  });
}
