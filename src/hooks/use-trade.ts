"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import type { InputEntryFunctionData } from "@aptos-labs/ts-sdk";
import {
  aptos,
  buildBuyYesTxn,
  buildBuyNoTxn,
  buildSellYesTxn,
  buildSellNoTxn,
} from "@/lib/aptos";
import { portfolioOnChainQueryKey } from "./use-portfolio-onchain";
import { activeCaseQueryKey } from "./use-active-case";

export interface TradeArgs {
  caseId: bigint;
  side: "YES" | "NO";
  direction: "BUY" | "SELL";
  /** Float amount in vUSD (BUY) or shares (SELL). Hook converts to 1e6 raw. */
  amount: number;
}

export interface TradeResultOnChain {
  txnHash: string;
  side: "YES" | "NO";
  direction: "BUY" | "SELL";
}

const toRaw = (x: number): bigint => BigInt(Math.round(x * 1e6));

/**
 * Slice 3 Phase A — wallet-signed on-chain buy/sell mutation.
 * Replaces the old `/api/markets/[id]/trade` POST. Non-custodial: user signs
 * each txn from their Aptos wallet. v0 slippage protection is `minOut = 0n`
 * (deferred). Phase B will layer on claim + cleanup.
 */
export function useTrade(groupId: string | null) {
  const queryClient = useQueryClient();
  const { account, signAndSubmitTransaction } = useWallet();
  const address = account?.address?.toString() ?? undefined;

  return useMutation<TradeResultOnChain, Error, TradeArgs>({
    mutationFn: async ({ caseId, side, direction, amount }) => {
      if (!account) throw new Error("Connect wallet first");
      const raw = toRaw(amount);
      if (raw <= 0n) throw new Error("Amount must be positive");

      // Build payload. Slippage protection deferred (v0): minOut = 0n.
      const payload =
        direction === "BUY"
          ? side === "YES"
            ? buildBuyYesTxn(caseId, raw, 0n)
            : buildBuyNoTxn(caseId, raw, 0n)
          : side === "YES"
            ? buildSellYesTxn(caseId, raw, 0n)
            : buildSellNoTxn(caseId, raw, 0n);

      const pending = await signAndSubmitTransaction({
        sender: account.address,
        data: payload.data as InputEntryFunctionData,
      });
      await aptos.waitForTransaction({
        transactionHash: pending.hash,
        options: { timeoutSecs: 30 },
      });
      return { txnHash: pending.hash, side, direction };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: portfolioOnChainQueryKey(address) });
      if (groupId) {
        queryClient.invalidateQueries({ queryKey: activeCaseQueryKey(groupId) });
      }
      // Cold path: detail pages may still be mounted; mark stale so they
      // re-fetch on next focus but don't force it now.
      queryClient.invalidateQueries({ queryKey: ["market"], refetchType: "none" });
    },
  });
}
