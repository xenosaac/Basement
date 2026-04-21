"use client";

import { useUser } from "@/hooks/use-user";
import { formatUSD } from "@/lib/utils";
import { FaucetButton } from "./faucet-button";

export function PortfolioSummary() {
  const user = useUser();

  if (!user.isConnected) {
    return <div className="glass rounded-lg p-6 h-24 animate-pulse" />;
  }

  // TODO: Session B contract deploy → read on-chain VirtualUSD balance via aptos.ts
  const balance = 0;

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
