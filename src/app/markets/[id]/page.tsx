"use client";

import { useParams } from "next/navigation";
import { useMarket } from "@/hooks/use-market";
import { usePortfolio } from "@/hooks/use-portfolio";
import { TradePanel } from "@/components/trade-panel";
import { PositionCard } from "@/components/position-card";
import { formatUSD, formatPercent, shortenAddress, timeRemaining } from "@/lib/utils";

export default function MarketPage() {
  const { id } = useParams<{ id: string }>();
  const { data: market, isLoading } = useMarket(id);
  const { data: portfolio } = usePortfolio();

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

  const myPositions = portfolio?.positions.filter((p) => p.marketId === id) ?? [];
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
            <span className="text-xs text-white/30">{timeRemaining(market.closeTime)} left</span>
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

          {/* Positions */}
          {myPositions.length > 0 && (
            <div>
              <h2 className="text-xs text-white/35 uppercase tracking-wider mb-3">Your Positions</h2>
              <div className="space-y-2">
                {myPositions.map((pos) => (
                  <PositionCard key={pos.id} position={pos} />
                ))}
              </div>
            </div>
          )}

          {/* Recent trades */}
          {market.recentTrades && market.recentTrades.length > 0 && (
            <div>
              <h2 className="text-xs text-white/35 uppercase tracking-wider mb-3">Recent Activity</h2>
              <div className="glass rounded-lg overflow-x-auto">
                <table className="w-full text-xs min-w-[480px] sm:min-w-0">
                  <thead>
                    <tr className="border-b border-glass-border text-white/30">
                      <th className="text-left px-4 py-2.5 font-medium">Side</th>
                      <th className="text-right px-4 py-2.5 font-medium">Amount</th>
                      <th className="text-right px-4 py-2.5 font-medium">Shares</th>
                      <th className="text-right px-4 py-2.5 font-medium">Price</th>
                      <th className="text-right px-4 py-2.5 font-medium hidden sm:table-cell">Trader</th>
                    </tr>
                  </thead>
                  <tbody>
                    {market.recentTrades.map((t) => (
                      <tr key={t.id} className="border-b border-glass-border/50 last:border-0">
                        <td className="px-4 py-2.5">
                          <span className={t.side === "YES" ? "text-yes" : "text-no"}>{t.side}</span>
                        </td>
                        <td className="text-right px-4 py-2.5 text-white/60">{formatUSD(t.amountSpent)}</td>
                        <td className="text-right px-4 py-2.5 text-white/60">{t.sharesReceived.toFixed(1)}</td>
                        <td className="text-right px-4 py-2.5 text-white/60">{formatPercent(t.priceAtTrade)}</td>
                        <td className="text-right px-4 py-2.5 text-white/30 hidden sm:table-cell">{shortenAddress(t.userAddress)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right: Trade panel */}
        <div>
          <TradePanel
            marketId={market.id}
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
