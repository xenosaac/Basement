"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiErrorResponse, BetResponse, BetSide, SeriesId } from "@/lib/types/v3-api";

export interface BetArgs {
  seriesId: SeriesId;
  roundIdx: number;
  side: BetSide;
  amountCents: number; // integer
  /**
   * Optional client-supplied nonce. If provided, the caller (e.g.
   * `<InlineTradeWidget>`) reuses this nonce on retry so that the
   * server-side `orders_v3_nonce_uniq` unique-index deduplicates a
   * re-submitted bet (prevents double-betting after a timeout retry).
   * If absent, a fresh UUID v4 is generated for each call.
   */
  nonce?: string;
}

export class BetError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function useBetV3() {
  const queryClient = useQueryClient();

  return useMutation<BetResponse, BetError, BetArgs>({
    mutationFn: async (args) => {
      const nonce = args.nonce ?? crypto.randomUUID();
      const body = {
        seriesId: args.seriesId,
        roundIdx: args.roundIdx,
        side: args.side,
        amountCents: args.amountCents,
        nonce,
      };
      const res = await fetch("/api/bet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as ApiErrorResponse | null;
        throw new BetError(
          err?.error?.code ?? "INTERNAL",
          err?.error?.message ?? `Bet failed (${res.status})`,
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

export function codeToUserMessage(code: string): string {
  switch (code) {
    case "INSUFFICIENT_BALANCE":
      return "Not enough vUSD — claim from the faucet first.";
    case "BET_TOO_SMALL":
      return "Minimum bet is $0.10.";
    case "BET_TOO_LARGE":
      return "Bet exceeds maximum size.";
    case "ROUND_CLOSED":
      return "Round closed — next round is opening.";
    case "ROUND_NOT_FOUND":
      return "Round not yet available. Try again in a moment.";
    case "MARKET_CLOSED":
      return "This market is currently closed (outside trading hours).";
    case "UNAUTHORIZED":
      return "Please connect your wallet and sign in.";
    case "FAUCET_COOLDOWN":
      return "Faucet already claimed. Try again in 24 hours.";
    case "DUPLICATE_NONCE":
      return "Duplicate request — please retry.";
    default:
      return `Something went wrong (${code}).`;
  }
}
