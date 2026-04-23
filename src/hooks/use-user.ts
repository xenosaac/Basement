"use client";

import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useAptosAuth } from "@/components/aptos-auth-provider";

/**
 * Returns the current wallet + auth state. Balances live on-chain and are
 * read via `readUserVirtualUsdBalance`, surfaced through `usePortfolioOnChain`.
 */
export function useUser() {
  const { account, connected, wallet } = useWallet();
  const { isAuthenticated, supportsFeePayer } = useAptosAuth();

  const address = account?.address?.toString() ?? null;
  const walletName = wallet?.name ?? null;

  return {
    address,
    isConnected: connected,
    isAuthenticated,
    walletName,
    supportsFeePayer,
  };
}
