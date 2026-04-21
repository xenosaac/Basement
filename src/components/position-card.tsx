"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { portfolioAddressQueryKey } from "@/hooks/use-portfolio-query";
import type { PositionView } from "@/types";
import { formatUSD, formatPercent } from "@/lib/utils";
import { useAptosAuth } from "./aptos-auth-provider";

export function PositionCard({ position }: { position: PositionView }) {
  const { account } = useWallet();
  const address = account?.address?.toString() ?? undefined;
  const queryClient = useQueryClient();
  const { isAuthenticated, isAuthenticating, authError, signIn } = useAptosAuth();

  const claim = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/markets/${position.marketId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: portfolioAddressQueryKey(address) });
      queryClient.invalidateQueries({ queryKey: ["market", position.marketId] });
    },
  });

  const isResolved = position.marketState === "RESOLVED" || position.marketState === "SETTLED";
  const isWinner = isResolved && position.claimableAmount > 0;
  const isLoser = isResolved && !isWinner;
  const alreadyClaimed = isWinner && position.claimed;

  return (
    <div className="glass rounded-lg px-5 py-4 flex items-center gap-5">
      {/* Market info */}
      <div className="flex-1 min-w-0">
        <Link
          href={`/markets/${position.marketId}`}
          className="text-sm font-medium text-white hover:text-accent transition-colors line-clamp-1"
        >
          {position.marketQuestion}
        </Link>
        <div className="flex items-center gap-3 mt-1.5">
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${
            position.side === "YES" ? "bg-yes-dim text-yes" : "bg-no-dim text-no"
          }`}>
            {position.side}
          </span>
          <span className="text-xs text-white/30">
            {position.sharesReceived.toFixed(1)} shares @ {formatPercent(position.avgPrice)}
          </span>
          {isResolved && position.resolvedOutcome && (
            <span className="text-xs text-white/40">
              {position.resolvedOutcome} won
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="hidden sm:flex gap-6 text-xs shrink-0">
        <div>
          <span className="text-white/30 block">Cost</span>
          <span className="text-white">{formatUSD(position.amountSpent)}</span>
        </div>
        <div>
          <span className="text-white/30 block">Value</span>
          <span className="text-white">
            {isLoser ? "$0.00" : formatUSD(position.currentValue)}
          </span>
        </div>
        <div>
          <span className="text-white/30 block">P&L</span>
          <span className={isLoser ? "text-no" : position.pnl >= 0 ? "text-yes" : "text-no"}>
            {isLoser
              ? `-${formatUSD(position.amountSpent)}`
              : `${position.pnl >= 0 ? "+" : ""}${formatUSD(position.pnl)}`}
          </span>
        </div>
      </div>

      {/* Claim / status */}
      <div className="shrink-0 flex items-center gap-2">
        {position.claimable && !isAuthenticated && (
          <>
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-yes-dim text-yes">Won</span>
            <button
              onClick={signIn}
              disabled={isAuthenticating}
              title={authError?.message}
              className="px-4 py-2 bg-accent text-black text-xs font-semibold rounded-md hover:shadow-glow-sm transition-all disabled:opacity-50"
            >
              {isAuthenticating ? "..." : "Sign In to Claim"}
            </button>
          </>
        )}
        {position.claimable && isAuthenticated && (
          <>
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-yes-dim text-yes">Won</span>
            <button
              onClick={() => claim.mutate()}
              disabled={claim.isPending}
              className="px-4 py-2 bg-accent text-black text-xs font-semibold rounded-md hover:shadow-glow-sm transition-all disabled:opacity-50"
            >
              {claim.isPending ? "..." : `Claim ${formatUSD(position.claimableAmount)}`}
            </button>
          </>
        )}
        {alreadyClaimed && (
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-yes-dim/50 text-yes/50">Claimed</span>
        )}
        {isLoser && (
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-no-dim/50 text-no/50">Lost</span>
        )}
      </div>
    </div>
  );
}
