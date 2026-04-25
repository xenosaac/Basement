"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ApiErrorResponse,
  SellResponse,
  BetSide,
  SeriesId,
} from "@/lib/types/v3-api";

export interface SellArgs {
  seriesId: SeriesId;
  roundIdx: number;
  side: BetSide;
  sharesE8: bigint;
  nonce?: string;
}

export class SellError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function useSellV3() {
  const queryClient = useQueryClient();

  return useMutation<SellResponse, SellError, SellArgs>({
    mutationFn: async (args) => {
      const nonce = args.nonce ?? crypto.randomUUID();
      const body = {
        seriesId: args.seriesId,
        roundIdx: args.roundIdx,
        side: args.side,
        sharesE8: args.sharesE8.toString(),
        nonce,
      };
      const res = await fetch("/api/sell", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as ApiErrorResponse | null;
        throw new SellError(
          err?.error?.code ?? "INTERNAL",
          err?.error?.message ?? `Sell failed (${res.status})`,
        );
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["series-v3"] });
      queryClient.invalidateQueries({ queryKey: ["balance-v3"] });
      queryClient.invalidateQueries({ queryKey: ["orders-v3"] });
      queryClient.invalidateQueries({ queryKey: ["positions-v3"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    },
  });
}

export function sellCodeToUserMessage(code: string): string {
  switch (code) {
    case "INSUFFICIENT_SHARES":
      return "You don't hold enough shares to sell.";
    case "ROUND_CLOSED":
      return "Round closed — selling is only allowed before close.";
    case "ROUND_NOT_FOUND":
      return "Round not found.";
    case "QUOTE_FAILED":
      return "Pricing temporarily unavailable; try again.";
    case "UNAUTHORIZED":
      return "Please connect your wallet and sign in.";
    case "DUPLICATE_NONCE":
      return "Duplicate request — please retry.";
    default:
      return `Something went wrong (${code}).`;
  }
}
