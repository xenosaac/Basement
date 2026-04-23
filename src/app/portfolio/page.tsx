"use client";

import "@/lib/ensure-server-localstorage";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import {
  usePortfolioOnChain,
  type OnChainPosition,
} from "@/hooks/use-portfolio-onchain";
import { PortfolioSummary } from "@/components/portfolio-summary";
import { NavbarWalletControls } from "@/components/navbar-wallet-controls";
import { useClaim } from "@/hooks/use-claim";
import { formatUSD } from "@/lib/utils";

function stateLabel(s: OnChainPosition["state"]): string {
  switch (s) {
    case 0:
      return "OPEN";
    case 1:
      return "CLOSED";
    case 2:
      return "RESOLVED";
    case 3:
      return "DRAINED";
    default:
      return "UNKNOWN";
  }
}

function isClaimable(p: OnChainPosition): boolean {
  if (p.state !== 2) return false;
  if (p.resolvedOutcome === 0 && p.yesShares > 0n) return true;
  if (p.resolvedOutcome === 1 && p.noShares > 0n) return true;
  return false;
}

function PositionRow({ p }: { p: OnChainPosition }) {
  const yes = Number(p.yesShares) / 1_000_000;
  const no = Number(p.noShares) / 1_000_000;
  return (
    <div className="glass rounded-lg px-5 py-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-white/90 truncate">
          {p.question ?? `Case #${p.caseId}`}
        </p>
        <p className="text-xs text-white/40 mt-1">
          Close: {new Date(p.closeTime * 1000).toLocaleString()}
        </p>
      </div>
      <div className="flex items-center gap-4 text-xs text-white/70 shrink-0">
        <div className="text-right">
          <div>YES {yes.toFixed(4)}</div>
          <div>NO {no.toFixed(4)}</div>
        </div>
        <div className="text-right">
          <span className="text-white/40">{stateLabel(p.state)}</span>
        </div>
      </div>
    </div>
  );
}

function ClaimablePositionRow({ p }: { p: OnChainPosition }) {
  const yes = Number(p.yesShares) / 1_000_000;
  const no = Number(p.noShares) / 1_000_000;
  const winningSideShares =
    p.resolvedOutcome === 0 ? p.yesShares : p.noShares;
  const claimableShares = Number(winningSideShares) / 1_000_000;
  const { claim, isPending, message } = useClaim(BigInt(p.caseId));

  return (
    <div className="glass rounded-lg px-5 py-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-white/90 truncate">
          {p.question ?? `Case #${p.caseId}`}
        </p>
        <p className="text-xs text-white/40 mt-1">
          Close: {new Date(p.closeTime * 1000).toLocaleString()}
        </p>
        {message && (
          <p className="text-xs text-white/60 mt-1">{message}</p>
        )}
      </div>
      <div className="flex items-center gap-4 text-xs text-white/70 shrink-0">
        <div className="text-right">
          <div>YES {yes.toFixed(4)}</div>
          <div>NO {no.toFixed(4)}</div>
        </div>
        <button
          type="button"
          onClick={() => claim()}
          disabled={isPending}
          className="px-3 py-1.5 rounded-pill bg-accent text-black text-xs font-semibold hover:shadow-glow-sm transition-all disabled:opacity-50"
        >
          {isPending ? "Claiming…" : `Claim $${formatUSD(claimableShares)}`}
        </button>
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const { connected: isConnected } = useWallet();
  const { data: portfolio, isLoading } = usePortfolioOnChain();

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

  const positions: OnChainPosition[] = portfolio?.positions ?? [];
  const claimable = positions.filter(isClaimable);
  const open = positions.filter((p) => p.state === 0 || p.state === 1);
  const resolved = positions.filter(
    (p) => (p.state === 2 || p.state === 3) && !isClaimable(p),
  );

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
            {claimable.map((p) => (
              <ClaimablePositionRow key={p.caseId} p={p} />
            ))}
          </div>
        </div>
      )}

      {open.length > 0 && (
        <div>
          <h2 className="text-xs text-white/35 uppercase tracking-wider mb-3">Active Positions</h2>
          <div className="space-y-2">
            {open.map((p) => (
              <PositionRow key={p.caseId} p={p} />
            ))}
          </div>
        </div>
      )}

      {resolved.length > 0 && (
        <div>
          <h2 className="text-xs text-white/35 uppercase tracking-wider mb-3">Resolved</h2>
          <div className="space-y-2">
            {resolved.map((p) => (
              <PositionRow key={p.caseId} p={p} />
            ))}
          </div>
        </div>
      )}

      {positions.length === 0 && (
        <div className="text-center py-16 text-white/30">
          <p className="mb-1">No positions yet.</p>
          <p className="text-xs text-white/20">Browse markets and make your first trade.</p>
        </div>
      )}
    </div>
  );
}
