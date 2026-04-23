"use client";

import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useFaucet } from "@/hooks/use-faucet";
import { useUser } from "@/hooks/use-user";
import { usePortfolioOnChain } from "@/hooks/use-portfolio-onchain";
import { useAptosAuth } from "./aptos-auth-provider";

export function FaucetBannerInner() {
  const { connected: isConnected } = useWallet();
  const user = useUser();
  const { isAuthenticated } = useAptosAuth();
  const { claim, isPending, message } = useFaucet();
  const { data: portfolio } = usePortfolioOnChain();

  const balance = Number(portfolio?.balance ?? 0n) / 1_000_000;
  if (!isConnected || !isAuthenticated || !user || balance > 0) {
    return null;
  }

  return (
    <div className="glass rounded-lg p-5 mb-6 flex items-center justify-between border border-accent/20">
      <div>
        <p className="text-sm font-medium text-white">You have 0 VirtualUSD</p>
        <p className="text-xs text-white/40 mt-0.5">Claim 50 free VirtualUSD to start trading.</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => claim()}
          disabled={isPending}
          className="px-4 py-2 bg-accent text-black text-sm font-semibold rounded-pill hover:shadow-glow-sm transition-all disabled:opacity-50"
        >
          {isPending ? "Claiming..." : "Claim Now"}
        </button>
        {message && (
          <span className={`text-xs ${message.startsWith("+") ? "text-yes" : "text-no"}`}>{message}</span>
        )}
      </div>
    </div>
  );
}
