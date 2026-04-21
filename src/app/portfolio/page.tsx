"use client";

import "@/lib/ensure-server-localstorage";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { usePortfolio } from "@/hooks/use-portfolio";
import { PortfolioSummary } from "@/components/portfolio-summary";
import { PositionCard } from "@/components/position-card";
import { NavbarWalletControls } from "@/components/navbar-wallet-controls";

export default function PortfolioPage() {
  const { connected: isConnected } = useWallet();
  const { data: portfolio, isLoading } = usePortfolio();

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 text-center py-24">
        <h1 className="text-2xl font-bold text-white mb-4">Portfolio</h1>
        <p className="text-white/40 mb-6">Connect your wallet to view positions.</p>
        <div className="flex items-center justify-center gap-2">
          <NavbarWalletControls />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-4 animate-pulse">
        <div className="glass rounded-lg h-24" />
        <div className="glass rounded-lg h-20" />
        <div className="glass rounded-lg h-20" />
      </div>
    );
  }

  const open = portfolio?.positions.filter((p) => p.marketState === "OPEN" || p.marketState === "CLOSED") ?? [];
  const resolved = portfolio?.positions.filter((p) => p.marketState === "RESOLVED" || p.marketState === "SETTLED") ?? [];
  const claimable = resolved.filter((p) => p.claimable);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-4">Portfolio</h1>
        <PortfolioSummary />
      </div>

      {claimable.length > 0 && (
        <div>
          <h2 className="text-xs text-accent uppercase tracking-wider mb-3">Claimable</h2>
          <div className="space-y-2">
            {claimable.map((p) => <PositionCard key={p.id} position={p} />)}
          </div>
        </div>
      )}

      {open.length > 0 && (
        <div>
          <h2 className="text-xs text-white/35 uppercase tracking-wider mb-3">Active Positions</h2>
          <div className="space-y-2">
            {open.map((p) => <PositionCard key={p.id} position={p} />)}
          </div>
        </div>
      )}

      {resolved.filter((p) => !p.claimable).length > 0 && (
        <div>
          <h2 className="text-xs text-white/35 uppercase tracking-wider mb-3">Resolved</h2>
          <div className="space-y-2">
            {resolved.filter((p) => !p.claimable).map((p) => <PositionCard key={p.id} position={p} />)}
          </div>
        </div>
      )}

      {(portfolio?.positions.length ?? 0) === 0 && (
        <div className="text-center py-16 text-white/30">
          <p className="mb-1">No positions yet.</p>
          <p className="text-xs text-white/20">Browse markets and make your first trade.</p>
        </div>
      )}
    </div>
  );
}
