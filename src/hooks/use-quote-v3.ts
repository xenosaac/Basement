"use client";

import { useQuery } from "@tanstack/react-query";
import type { QuoteResponse, BetSide, SeriesId } from "@/lib/types/v3-api";

export interface QuoteArgs {
  seriesId: SeriesId;
  roundIdx: number | undefined;
  side?: BetSide;
  amountCents?: number;
  sharesE8?: bigint;
  enabled?: boolean;
}

const POLL_MS = 3_000;

export function useQuoteV3(args: QuoteArgs) {
  const { seriesId, roundIdx, side, amountCents, sharesE8, enabled } = args;
  const enabledFinal = enabled !== false && roundIdx !== undefined;

  return useQuery<QuoteResponse>({
    queryKey: [
      "quote-v3",
      seriesId,
      roundIdx,
      side ?? null,
      amountCents ?? null,
      sharesE8?.toString() ?? null,
    ],
    queryFn: async () => {
      const sp = new URLSearchParams({
        seriesId,
        roundIdx: String(roundIdx),
      });
      if (side) sp.set("side", side);
      if (amountCents !== undefined) sp.set("amountCents", String(amountCents));
      if (sharesE8 !== undefined) sp.set("sharesE8", sharesE8.toString());
      const res = await fetch(`/api/quote?${sp.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`quote failed (${res.status})`);
      return res.json();
    },
    enabled: enabledFinal,
    refetchInterval: POLL_MS,
    staleTime: POLL_MS / 2,
    refetchOnWindowFocus: true,
  });
}
