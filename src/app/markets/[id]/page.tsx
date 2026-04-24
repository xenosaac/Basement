"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useMarket } from "@/hooks/use-market";
import { usePortfolioOnChain } from "@/hooks/use-portfolio-onchain";
import { useActiveCase } from "@/hooks/use-active-case";
import { TradePanel } from "@/components/trade-panel";
import { formatUSD, formatPercent, timeRemaining } from "@/lib/utils";

export default function MarketPage() {
  const { id } = useParams<{ id: string }>();
  const { data: market, isLoading } = useMarket(id);
  const { data: portfolio } = usePortfolioOnChain();
  // Active on-chain case id for this market's recurring group (drives
  // "Your Positions" filter + TradePanel). Phase B will add claim button.
  const { data: activeCaseId } = useActiveCase(market?.recurringGroupId ?? null);

  // Per-second tick so the "Xm Ys left" countdown in the header updates
  // live instead of being frozen to the last render. Matches the Quick Play
  // strip granularity from market-grid.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-4 animate-pulse">
        <div className="h-8 bg-white/5 rounded w-3/4" />
        <div className="h-4 bg-white/5 rounded w-1/2" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
          <div className="lg:col-span-2 h-48 bg-white/5 rounded-lg" />
          <div className="h-64 bg-white/5 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!market) {
    return <div className="text-center py-20 text-white/40">Market not found.</div>;
  }

  // On-chain positions for the currently-active case in this group.
  // TODO(phase-b): add a claim button here for resolved cases.
  const myPositions = (portfolio?.positions ?? []).filter(
    (p) => activeCaseId != null && p.caseId === activeCaseId.toString(),
  );
  const isLive = market.state === "OPEN";

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          {isLive && (
            <span className="flex items-center gap-1.5 text-xs text-white/40 bg-white/[0.04] px-2.5 py-1 rounded-pill">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          )}
          {market.state === "RESOLVED" && (
            <span className="text-xs text-accent bg-accent-dim px-2.5 py-1 rounded-pill">
              Resolved: {market.resolvedOutcome}
            </span>
          )}
          {market.closeTime && isLive && (
            <span className="text-xs text-white/30 font-mono tabular-nums">
              {timeRemaining(market.closeTime, nowMs)} left
            </span>
          )}
        </div>
        <h1 className="text-xl font-bold text-white mb-2">{market.question}</h1>
        {market.description && (
          <p className="text-sm text-white/35 leading-relaxed line-clamp-3">{market.description}</p>
        )}
      </div>

      {/* Resolution banner */}
      {(market.state === "RESOLVED" || market.state === "SETTLED") && market.resolvedOutcome && (
        <div className="mb-6 rounded-lg border border-yes/30 bg-yes/5 px-5 py-4">
          <div className="flex items-center gap-2 text-yes font-semibold">
            <span>✓</span>
            <span>{market.state === "SETTLED" ? "Settled" : "Resolved"}: {market.resolvedOutcome} won</span>
          </div>
          <p className="text-sm text-white/50 mt-1">Winning shares pay $1.00 each</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Market info + positions + trades */}
        <div className="lg:col-span-2 space-y-6">
          {/* Price display */}
          <div className="glass rounded-lg p-6">
            <div className="flex gap-4 mb-4">
              <div className="flex-1 flex flex-col items-center py-4 rounded-md bg-yes-dim border border-yes-border">
                <span className="text-xs text-white/40 uppercase mb-1">Yes</span>
                <span className="text-2xl font-bold text-yes">{formatPercent(market.yesPrice)}</span>
              </div>
              <div className="flex-1 flex flex-col items-center py-4 rounded-md bg-no-dim border border-no-border">
                <span className="text-xs text-white/40 uppercase mb-1">No</span>
                <span className="text-2xl font-bold text-no">{formatPercent(market.noPrice)}</span>
              </div>
            </div>
            <div className="text-xs text-white/25 text-center">
              Volume: {formatUSD(market.totalVolume)} VirtualUSD
            </div>
          </div>

          {/* Positions — on-chain shares (Phase A). Claim button lives in Phase B. */}
          {myPositions.length > 0 && (
            <div>
              <h2 className="text-xs text-white/35 uppercase tracking-wider mb-3">Your Positions</h2>
              <div className="space-y-2">
                {myPositions.map((pos) => {
                  const yes = Number(pos.yesShares) / 1e6;
                  const no = Number(pos.noShares) / 1e6;
                  return (
                    <div key={pos.caseId} className="space-y-2">
                      {yes > 0 && (
                        <div className="glass rounded-lg px-4 py-3 flex items-center justify-between">
                          <span className="text-xs font-semibold uppercase tracking-wider text-yes">Yes</span>
                          <span className="text-sm text-white/70 font-mono">{yes.toFixed(2)} shares</span>
                        </div>
                      )}
                      {no > 0 && (
                        <div className="glass rounded-lg px-4 py-3 flex items-center justify-between">
                          <span className="text-xs font-semibold uppercase tracking-wider text-no">No</span>
                          <span className="text-sm text-white/70 font-mono">{no.toFixed(2)} shares</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        {/* Right: Trade panel */}
        <div>
          <TradePanel
            recurringGroupId={market.recurringGroupId ?? null}
            yesDemand={market.yesDemand}
            noDemand={market.noDemand}
            yesPrice={market.yesPrice}
            noPrice={market.noPrice}
            state={market.state}
          />
        </div>
      </div>
    </div>
  );
}
