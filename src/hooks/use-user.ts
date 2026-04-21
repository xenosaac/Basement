"use client";

import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useAptosAuth } from "@/components/aptos-auth-provider";

/**
 * Returns the current wallet + auth state. Does NOT return a `balance`
 * field — real balances now live on-chain and will be read via
 * `readUserVirtualUsdBalance` (Session A T4) and surfaced through a
 * portfolio hook in Session D (T5).
 *
 * Session-C-deprecated `users.balance` schema column is still physically
 * present but unread; Session C drops it.
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
