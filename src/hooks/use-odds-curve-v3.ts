"use client";

import { useQuery } from "@tanstack/react-query";

export interface OddsCurvePoint {
  t: number;
  upCents: number;
  downCents: number;
}

export interface OddsCurveResponse {
  seriesId: string;
  roundIdx: number;
  startTimeSec: number;
  closeTimeSec: number;
  state: "OPEN" | "CLOSED" | "RESOLVED" | "VOID";
  resolvedOutcome: "UP" | "DOWN" | "INVALID" | null;
  points: OddsCurvePoint[];
  current: { upCents: number; downCents: number };
}

const POLL_MS_OPEN = 4_000;

export function useOddsCurveV3(
  seriesId: string | undefined,
  roundIdx: number | undefined,
) {
  return useQuery<OddsCurveResponse>({
    queryKey: ["odds-curve", seriesId, roundIdx],
    queryFn: async () => {
      const sp = new URLSearchParams({
        seriesId: String(seriesId),
        roundIdx: String(roundIdx),
      });
      const res = await fetch(`/api/case/odds-curve?${sp.toString()}`);
      if (!res.ok) throw new Error(`odds-curve failed (${res.status})`);
      return res.json();
    },
    enabled: Boolean(seriesId && roundIdx !== undefined),
    refetchInterval: (q) =>
      q.state.data?.state === "OPEN" ? POLL_MS_OPEN : false,
    staleTime: POLL_MS_OPEN / 2,
  });
}
