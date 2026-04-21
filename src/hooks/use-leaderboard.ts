"use client";

import { useQuery } from "@tanstack/react-query";
import type { LeaderboardEntry } from "@/types";

export function useLeaderboard(limit = 20) {
  return useQuery<LeaderboardEntry[]>({
    queryKey: ["leaderboard", limit],
    queryFn: async () => {
      const res = await fetch(`/api/leaderboard?limit=${limit}`);
      if (!res.ok) throw new Error("Failed to fetch leaderboard");
      return res.json();
    },
    // Leaderboard is not real-time critical: dedupe mount refetches with 60s staleness
    // and poll once per minute. Previously: 0 staleTime + 30s poll = 2× traffic for no user benefit.
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
