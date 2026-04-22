"use client";

import { useUser } from "@/hooks/use-user";
import { usePortfolio } from "@/hooks/use-portfolio";
import { formatUSD } from "@/lib/utils";
import { FaucetButton } from "./faucet-button";

export function PortfolioSummary() {
  const user = useUser();
  const { data: portfolio } = usePortfolio();

  if (!user.isConnected) {
    return <div className="glass rounded-lg p-6 h-24 animate-pulse" />;
  }

  // TEMPORARY: reads v0 DB balance via /api/portfolio. Session D will rewire
  // this to read on-chain VirtualUSD FA balance via src/lib/aptos.ts.
  const balance = portfolio?.balance ?? 0;

  return (
    <div className="glass rounded-lg p-6 flex items-center justify-between">
      <div>
        <p className="text-xs text-white/35 uppercase tracking-wider mb-1">Available Balance</p>
        <p className="text-3xl font-bold text-white">
          {formatUSD(balance)}
          <span className="text-base text-white/30 ml-2">VirtualUSD</span>
        </p>
      </div>
      <FaucetButton />
    </div>
  );
}
