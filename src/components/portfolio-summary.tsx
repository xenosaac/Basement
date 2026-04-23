"use client";

import { useUser } from "@/hooks/use-user";
import { usePortfolioOnChain } from "@/hooks/use-portfolio-onchain";
import { formatUSD } from "@/lib/utils";
import { FaucetButton } from "./faucet-button";

export function PortfolioSummary() {
  const user = useUser();
  const { data: portfolio } = usePortfolioOnChain();

  if (!user.isConnected) {
    return <div className="glass rounded-lg p-6 h-24 animate-pulse" />;
  }

  // On-chain VirtualUSD FA balance (1e6 raw units → USD).
  const balance = portfolio ? Number(portfolio.balance) / 1_000_000 : 0;

  return (
    <div className="glass rounded-lg p-6 flex items-center justify-between">
      <div>
        <p className="text-xs text-white/35 uppercase tracking-wider mb-1">Available Balance</p>
        <p className="text-3xl font-bold text-white">
          ${formatUSD(balance)}
        </p>
      </div>
      <FaucetButton />
    </div>
  );
}
