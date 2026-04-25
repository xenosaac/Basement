"use client";

import "@/lib/ensure-server-localstorage";
import Link from "next/link";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useUser } from "@/hooks/use-user";
import { useBalanceV3 } from "@/hooks/use-balance-v3";
import { useOrdersV3 } from "@/hooks/use-orders-v3";
import { usePositionsV3 } from "@/hooks/use-positions-v3";
import { useFaucetV3 } from "@/hooks/use-faucet-v3";
import { useSellV3, SellError, sellCodeToUserMessage } from "@/hooks/use-sell-v3";
import { BetError, codeToUserMessage } from "@/hooks/use-bet-v3";
import type { SeriesId, BetSide } from "@/lib/types/v3-api";
import { sideLabel, outcomeLabel } from "@/lib/utils";
import { NavbarWalletControls } from "@/components/navbar-wallet-controls";

function centsToUsd(cents: string | number | null | undefined) {
  if (cents == null) return "$0.00";
  const c = typeof cents === "string" ? Number(cents) : cents;
  return `$${(c / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function PortfolioPage() {
  const { connected } = useWallet();
  const user = useUser();
  const address = user.isConnected && user.address ? user.address : undefined;
  const { data: balance, isLoading: balanceLoading } = useBalanceV3(address);
  const { data: ordersData, isLoading: ordersLoading } = useOrdersV3(address);
  const { data: positionsData } = usePositionsV3(address);
  const sell = useSellV3();
  const faucet = useFaucetV3();

  if (!connected) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center">
        <h1 className="text-2xl font-bold text-white mb-4">Portfolio</h1>
        <p className="text-sm text-white/50 mb-6">Connect your wallet to view your portfolio.</p>
        <NavbarWalletControls />
      </div>
    );
  }
  if (!user.isConnected) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center">
        <h1 className="text-2xl font-bold text-white mb-2">Portfolio</h1>
        <p className="text-sm text-white/50">Sign in with your wallet to continue.</p>
      </div>
    );
  }

  const orders = ordersData?.orders ?? [];
  const resolvedOrders = orders.filter(
    (o) => o.caseState === "RESOLVED" || o.caseState === "VOID",
  );
  const allPositions = positionsData?.positions ?? [];
  const positions = allPositions.filter((p) => p.status === "OPEN");
  const claimable = allPositions.filter((p) => p.status === "CLAIMABLE");

  const nowSec = Math.floor(Date.now() / 1000);
  const canClaim =
    balance?.nextFaucetAtSec == null || balance.nextFaucetAtSec <= nowSec;

  // Canonical lifetime P&L: sum of realized PnL across all settled positions.
  // Single source of truth (matches /api/leaderboard).
  const totalProfit = Number(positionsData?.totalRealizedPnlCents ?? 0);
  const inBetsCents = Number(positionsData?.totalMarkValueCents ?? 0);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-white mb-1">Portfolio</h1>
      <p className="text-sm text-white/40 mb-8 font-mono">{address}</p>

      {/* Balance card */}
      <div className="glass rounded-lg p-6 mb-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-[2px] text-white/30 mb-1">
              Available
            </div>
            <div className="text-3xl font-mono tabular-nums text-white">
              {balanceLoading ? "…" : centsToUsd(balance?.availableCents)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-[2px] text-white/30 mb-1">
              Open positions
            </div>
            <div className="text-xl font-mono tabular-nums text-white/70">
              {centsToUsd(inBetsCents)}
            </div>
            <div className="text-[10px] text-white/30 mt-0.5">mark-to-market</div>
          </div>
        </div>
        <div className="border-t border-white/[0.06] pt-3 flex items-center justify-end">
          <span className="text-xs text-white/40 font-mono">
            Lifetime P&L:{" "}
            <span className={totalProfit >= 0 ? "text-yes" : "text-no"}>
              {totalProfit >= 0 ? "+" : ""}
              {centsToUsd(totalProfit)}
            </span>
          </span>
        </div>
      </div>

      {/* Faucet pill — 永远常驻在 balance 卡下方。24h cooldown 由 /api/faucet/claim 服务端强制。 */}
      <div className="glass rounded-pill px-5 py-2.5 mb-8 flex items-center justify-between gap-3">
        <span className="text-xs text-white/55">
          Free 50 VirtualUSD · 24h cooldown
        </span>
        <div className="flex items-center gap-3">
          {faucet.error instanceof BetError && (
            <span className="text-xs text-no">
              {codeToUserMessage(faucet.error.code)}
            </span>
          )}
          {canClaim ? (
            <button
              type="button"
              onClick={() => faucet.mutate()}
              disabled={faucet.isPending}
              className="px-3 py-1.5 rounded-pill bg-accent text-black text-xs font-semibold hover:shadow-glow-sm transition disabled:opacity-50"
            >
              {faucet.isPending ? "Claiming…" : "Claim 50 VirtualUSD"}
            </button>
          ) : (
            <span className="text-xs text-white/40 font-mono tabular-nums">
              Next claim in{" "}
              {Math.ceil(((balance?.nextFaucetAtSec ?? 0) - nowSec) / 3600)}h
            </span>
          )}
        </div>
      </div>

      {/* Open positions (pm-AMM, mark-to-market) */}
      {positions.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xs text-white/35 uppercase tracking-wider mb-3">
            Open Positions ({positions.length})
          </h2>
          <div className="space-y-2">
            {positions.map((p) => {
              const mark = Number(p.markValueCents ?? 0);
              const cost = Number(p.costBasisCents);
              const upnl = Number(p.unrealizedPnlCents ?? 0);
              const upWon = upnl > 0;
              const sharesNum = Number(p.sharesE8) / 1e8;
              return (
                <Link
                  key={`${p.seriesId}-${p.roundIdx}-${p.side}`}
                  href={`/series/${p.seriesId}/round/${p.roundIdx}`}
                  className="glass rounded-lg px-5 py-3 flex items-center justify-between gap-4 hover:border-white/[0.18] border border-transparent transition"
                >
                  <div>
                    <p className="text-sm text-white/90">
                      {p.seriesId} · Round {p.roundIdx}
                    </p>
                    <p className="text-xs text-white/40 mt-1 font-mono tabular-nums">
                      {sharesNum.toFixed(2)} sh · cost {centsToUsd(cost)}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold uppercase ${p.side === "UP" ? "text-yes" : "text-no"}`}
                  >
                    {sideLabel(p.side)}
                  </span>
                  <div className="text-right">
                    <div className="text-sm text-white/85 font-mono tabular-nums">
                      {centsToUsd(mark)}
                    </div>
                    <div
                      className={`text-[11px] font-mono tabular-nums ${upWon ? "text-yes" : upnl < 0 ? "text-no" : "text-white/40"}`}
                    >
                      {upnl >= 0 ? "+" : ""}
                      {centsToUsd(upnl)}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Resolved positions — redemption price locked. Sell to settle:
            winners @ $1, losers @ $0, voided rounds @ cost-basis refund. */}
      {claimable.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xs text-accent uppercase tracking-wider mb-3 flex items-center gap-2">
            Resolved · Ready to sell ({claimable.length})
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          </h2>
          <div className="space-y-2">
            {claimable.map((p) => {
              const payout = Number(p.claimableCents ?? 0);
              const cost = Number(p.costBasisCents);
              const profit = payout - cost;
              const sharesNum = Number(p.sharesE8) / 1e8;
              const pricePerShare = sharesNum > 0 ? payout / sharesNum / 100 : 0;
              const profitClass =
                profit > 0 ? "text-yes" : profit < 0 ? "text-no" : "text-white/40";
              const profitSign = profit > 0 ? "+" : "";
              const isPending =
                sell.isPending &&
                sell.variables?.seriesId === (p.seriesId as SeriesId) &&
                sell.variables?.roundIdx === p.roundIdx &&
                sell.variables?.side === p.side;
              return (
                <Link
                  key={`sell-${p.seriesId}-${p.roundIdx}-${p.side}`}
                  href={`/series/${p.seriesId}/round/${p.roundIdx}`}
                  className="glass rounded-lg px-5 py-3 flex items-center justify-between gap-4 hover:border-white/[0.18] border border-transparent transition"
                >
                  <div>
                    <p className="text-sm text-white/90">
                      {p.seriesId} · Round {p.roundIdx}
                    </p>
                    <p className="text-xs text-white/40 mt-1 font-mono tabular-nums">
                      {sharesNum.toFixed(2)} sh @ ${pricePerShare.toFixed(2)} ·{" "}
                      <span className={profitClass}>
                        {profitSign}
                        {centsToUsd(profit)}
                      </span>
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold uppercase ${p.side === "UP" ? "text-yes" : "text-no"}`}
                  >
                    {sideLabel(p.side)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      sell.mutate({
                        seriesId: p.seriesId as SeriesId,
                        roundIdx: p.roundIdx,
                        side: p.side as BetSide,
                        sharesE8: BigInt(p.sharesE8),
                      });
                    }}
                    disabled={sell.isPending}
                    className="px-3 py-1.5 rounded-md bg-accent text-black text-xs font-semibold hover:shadow-glow-sm transition disabled:opacity-50"
                  >
                    {isPending
                      ? "Selling…"
                      : payout > 0
                        ? `Sell ${centsToUsd(payout)}`
                        : "Close out"}
                  </button>
                </Link>
              );
            })}
          </div>
          {sell.error instanceof SellError && (
            <div className="mt-2 text-xs text-no">
              {sellCodeToUserMessage(sell.error.code)}
            </div>
          )}
        </div>
      )}

      {/* Resolved */}
      {resolvedOrders.length > 0 && (
        <div>
          <h2 className="text-xs text-white/35 uppercase tracking-wider mb-3">
            Resolved ({resolvedOrders.length})
          </h2>
          <div className="space-y-2">
            {resolvedOrders.slice(0, 30).map((o) => {
              const profit =
                Number(o.payoutCents ?? 0) - Number(o.amountCents);
              const won = profit > 0;
              return (
                <Link
                  key={o.orderId}
                  href={`/series/${o.seriesId}/round/${o.roundIdx}`}
                  className="glass rounded-lg px-5 py-3 flex items-center justify-between gap-4 hover:border-white/[0.18] border border-transparent transition"
                >
                  <div>
                    <p className="text-sm text-white/70">
                      {o.seriesId} · Round {o.roundIdx}
                    </p>
                    <p className="text-xs text-white/40 mt-1">
                      {sideLabel(o.side)} {centsToUsd(o.amountCents)} → outcome{" "}
                      {outcomeLabel(o.resolvedOutcome) ?? "—"}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-mono tabular-nums ${won ? "text-yes" : profit === 0 ? "text-white/40" : "text-no"}`}
                  >
                    {profit >= 0 ? "+" : ""}
                    {centsToUsd(profit)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {!ordersLoading && positions.length === 0 && claimable.length === 0 && resolvedOrders.length === 0 && (
        <div className="text-center py-16 text-white/40">
          <p className="mb-3">No bets yet.</p>
          <Link
            href="/markets"
            className="text-accent hover:underline text-sm"
          >
            Browse markets →
          </Link>
        </div>
      )}
    </div>
  );
}
