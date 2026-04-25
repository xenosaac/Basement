"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiErrorResponse, FaucetResponse } from "@/lib/types/v3-api";
import { BetError, codeToUserMessage } from "./use-bet-v3";

export function useFaucetV3() {
  const queryClient = useQueryClient();
  return useMutation<FaucetResponse, BetError, void>({
    mutationFn: async () => {
      const res = await fetch("/api/faucet/claim", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as ApiErrorResponse | null;
        throw new BetError(
          err?.error?.code ?? "INTERNAL",
          err?.error?.message ?? codeToUserMessage(err?.error?.code ?? "INTERNAL"),
        );
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["balance-v3"] });
    },
  });
}
