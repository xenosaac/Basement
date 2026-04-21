"use client";

import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { FAUCET_AMOUNT } from "@/lib/constants";
import { useAptosAuth } from "./aptos-auth-provider";
import { useFaucet } from "@/hooks/use-faucet";

export function FaucetButton() {
  const { account } = useWallet();
  const address = account?.address?.toString() ?? null;
  const { isAuthenticated, isAuthenticating, authError, signIn } = useAptosAuth();
  const { claim, isPending, message } = useFaucet();

  if (!address) return null;

  if (!isAuthenticated) {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={signIn}
          disabled={isAuthenticating}
          title={authError?.message}
          className="px-4 py-2 bg-accent text-black text-sm font-semibold rounded-md hover:shadow-glow-sm transition-all disabled:opacity-40"
        >
          {isAuthenticating
            ? "Signing..."
            : authError
            ? "Retry Sign-In"
            : "Sign In to Claim"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => claim()}
        disabled={isPending}
        className="px-4 py-2 bg-accent text-black text-sm font-semibold rounded-md hover:shadow-glow-sm transition-all disabled:opacity-40"
      >
        {isPending ? "Claiming..." : `Claim ${FAUCET_AMOUNT} VirtualUSD`}
      </button>
      {message && (
        <span className={`text-xs ${message.startsWith("+") ? "text-yes" : "text-no"}`}>{message}</span>
      )}
    </div>
  );
}
