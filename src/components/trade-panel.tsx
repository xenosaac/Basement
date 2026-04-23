"use client";

import "@/lib/ensure-server-localstorage";
import { useState, useCallback } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useTrade } from "@/hooks/use-trade";
import { usePortfolioOnChain } from "@/hooks/use-portfolio-onchain";
import { useActiveCase } from "@/hooks/use-active-case";
import { calculateTradeQuote, calculateSellQuote } from "@/lib/amm";
import { formatUSD, formatPercent } from "@/lib/utils";
import { useAptosAuth } from "./aptos-auth-provider";
import { NavbarWalletControls } from "./navbar-wallet-controls";
import { Toast } from "./toast";

/** Truncate a 0x... hash for toast display. */
function truncateHash(hash: string): string {
  if (!hash) return "";
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

export function TradePanel({
  recurringGroupId,
  yesDemand,
  noDemand,
  yesPrice,
  noPrice,
  state,
}: {
  /** Recurring group id (e.g. "btc-3m") — drives active-case lookup. */
  recurringGroupId: string | null;
  yesDemand: number;
  noDemand: number;
  yesPrice: number;
  noPrice: number;
  state: string;
}) {
  const { connected: isConnected } = useWallet();
  const { isAuthenticated, isAuthenticating, authError, signIn } = useAptosAuth();
  const { data: portfolio } = usePortfolioOnChain();
  const {
    data: activeCaseId,
    isLoading: isActiveCaseLoading,
    isError: isActiveCaseError,
    error: activeCaseError,
    refetch: refetchActiveCase,
  } = useActiveCase(recurringGroupId);
  const trade = useTrade(recurringGroupId);

  const [direction, setDirection] = useState<"BUY" | "SELL">("BUY");
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  const isSell = direction === "SELL";
  const numAmount = parseFloat(amount) || 0;

  // On-chain vUSD balance: bigint raw (1e6) → float for UI math.
  const balance = Number(portfolio?.balance ?? 0n) / 1e6;
  const isOpen = state === "OPEN";

  // Find position for the active on-chain case matching current side.
  const currentPosition = portfolio?.positions?.find(
    (p) => activeCaseId != null && p.caseId === activeCaseId.toString(),
  );
  const sharesOwned = currentPosition
    ? Number(side === "YES" ? currentPosition.yesShares : currentPosition.noShares) / 1e6
    : 0;

  const preview = numAmount > 0
    ? isSell
      ? calculateSellQuote(yesDemand, noDemand, side, numAmount)
      : calculateTradeQuote(yesDemand, noDemand, side, numAmount)
    : null;

  const handleTrade = () => {
    if (activeCaseId == null) return;
    if (isSell) {
      if (numAmount <= 0 || numAmount > sharesOwned) return;
    } else {
      if (numAmount <= 0 || numAmount > balance) return;
    }
    trade.mutate(
      { caseId: activeCaseId, side, direction, amount: numAmount },
      {
        onSuccess: (data) => {
          const verb = data.direction === "BUY" ? "Bought" : "Sold";
          setToast({
            message: `${verb} ${numAmount.toFixed(2)} ${data.side} · tx ${truncateHash(data.txnHash)}`,
            type: "success",
          });
          setAmount("");
        },
        onError: (err) => {
          setToast({ message: err.message, type: "error" });
        },
      }
    );
  };

  if (!isOpen) {
    return (
      <div className="glass rounded-lg p-6">
        <p className="text-center text-white/40 text-sm">
          {state === "RESOLVED" || state === "SETTLED"
            ? "Market resolved. Check portfolio for claims."
            : "Trading closed."}
        </p>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="glass rounded-lg p-6 flex flex-col items-center gap-4">
        <p className="text-white/40 text-sm">Connect wallet to trade</p>
        <div className="flex items-center gap-2">
          <NavbarWalletControls />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="glass rounded-lg p-6 flex flex-col items-center gap-4 text-center">
        <p className="text-white/40 text-sm">
          Sign in with your Aptos wallet to create your Basement session before trading.
        </p>
        <p className="text-white/25 text-xs">
          Sign-in only. No gas. No funds move.
        </p>
        {authError && (
          <p className="text-no text-xs max-w-xs">{authError.message}</p>
        )}
        <button
          onClick={signIn}
          disabled={isAuthenticating}
          className="px-4 py-2 bg-accent text-black text-sm font-semibold rounded-md hover:shadow-glow-sm transition-all disabled:opacity-40"
        >
          {isAuthenticating ? "Signing..." : "Sign In to Trade"}
        </button>
      </div>
    );
  }

  if (isActiveCaseLoading) {
    return (
      <div className="glass rounded-lg p-6">
        <p className="text-center text-white/40 text-sm">Loading active case...</p>
      </div>
    );
  }

  if (isActiveCaseError) {
    const msg =
      activeCaseError instanceof Error ? activeCaseError.message : String(activeCaseError);
    return (
      <div className="glass rounded-lg p-6 space-y-3">
        <p className="text-center text-no text-sm">Couldn&apos;t read active case from chain.</p>
        <p className="text-center text-xs text-white/40 font-mono break-all">{msg}</p>
        <button
          onClick={() => refetchActiveCase()}
          className="w-full px-4 py-2 bg-white/10 text-white text-xs font-semibold rounded-pill hover:bg-white/15 transition-all"
        >
          Retry
        </button>
      </div>
    );
  }

  if (activeCaseId == null) {
    return (
      <div className="glass rounded-lg p-6 space-y-3">
        <p className="text-center text-white/40 text-sm">No active case on-chain yet.</p>
        <p className="text-center text-xs text-white/30">
          The spawner runs every ~2 minutes. If this persists, the recurring
          group may be paused — check the Markets page for a working round.
        </p>
        <button
          onClick={() => refetchActiveCase()}
          className="w-full px-4 py-2 bg-white/10 text-white text-xs font-semibold rounded-pill hover:bg-white/15 transition-all"
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="glass rounded-lg p-5">
      {/* BUY / SELL direction toggle */}
      <div className="flex rounded-md overflow-hidden border border-glass-border mb-4">
        <button
          onClick={() => { setDirection("BUY"); setAmount(""); }}
          className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
            !isSell ? "bg-white/10 text-white" : "bg-transparent text-white/35 hover:text-white/60"
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => { setDirection("SELL"); setAmount(""); }}
          className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
            isSell ? "bg-white/10 text-white" : "bg-transparent text-white/35 hover:text-white/60"
          }`}
        >
          Sell
        </button>
      </div>

      {/* YES / NO toggle */}
      <div className="flex rounded-md overflow-hidden border border-glass-border mb-5">
        <button
          onClick={() => { setSide("YES"); setAmount(""); }}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
            side === "YES"
              ? "bg-yes text-white"
              : "bg-transparent text-white/40 hover:text-white/70"
          }`}
        >
          Yes {formatPercent(yesPrice)}
        </button>
        <button
          onClick={() => { setSide("NO"); setAmount(""); }}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
            side === "NO"
              ? "bg-no text-white"
              : "bg-transparent text-white/40 hover:text-white/70"
          }`}
        >
          No {formatPercent(noPrice)}
        </button>
      </div>

      {/* Amount input */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-white/35 mb-1.5">
          <span>{isSell ? "Shares to sell" : "Amount"}</span>
          {isSell ? (
            <button onClick={() => setAmount(String(sharesOwned))} className="text-accent hover:underline">
              Max: {sharesOwned.toFixed(2)} shares
            </button>
          ) : (
            <button onClick={() => setAmount(String(balance))} className="text-accent hover:underline">
              Max: {formatUSD(balance)}
            </button>
          )}
        </div>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-white/[0.04] border border-glass-border rounded-md px-3 py-2.5 text-white text-sm placeholder-white/25 focus:outline-hidden focus:border-accent/40 transition-colors"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/30">
            {isSell ? "shares" : "VirtualUSD"}
          </span>
        </div>
      </div>

      {/* Preview */}
      {preview && numAmount > 0 && (
        <div className="bg-white/[0.02] rounded-md p-3 mb-4 space-y-2 text-xs">
          {isSell ? (
            <>
              <div className="flex justify-between">
                <span className="text-white/35">Sell price</span>
                <span className="text-white">{formatPercent((preview as ReturnType<typeof calculateSellQuote>).pricePerShare)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/35">New prices</span>
                <span>
                  <span className="text-yes">{formatPercent(preview.newYesPrice)}</span>
                  <span className="text-white/20 mx-1">/</span>
                  <span className="text-no">{formatPercent(preview.newNoPrice)}</span>
                </span>
              </div>
              <div className="flex justify-between border-t border-glass-border pt-2 mt-2">
                <span className="text-white/35">You receive</span>
                <span className="text-accent font-medium">{formatUSD((preview as ReturnType<typeof calculateSellQuote>).proceeds)} VirtualUSD</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-white/35">Shares</span>
                <span className="text-white">{(preview as ReturnType<typeof calculateTradeQuote>).sharesReceived.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/35">Avg price</span>
                <span className="text-white">{formatPercent((preview as ReturnType<typeof calculateTradeQuote>).price)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/35">New prices</span>
                <span>
                  <span className="text-yes">{formatPercent(preview.newYesPrice)}</span>
                  <span className="text-white/20 mx-1">/</span>
                  <span className="text-no">{formatPercent(preview.newNoPrice)}</span>
                </span>
              </div>
              <div className="flex justify-between border-t border-glass-border pt-2 mt-2">
                <span className="text-white/35">Potential payout</span>
                <span className="text-accent font-medium">{formatUSD((preview as ReturnType<typeof calculateTradeQuote>).sharesReceived)} VirtualUSD</span>
              </div>
            </>
          )}
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={clearToast} />}

      <button
        onClick={handleTrade}
        disabled={trade.isPending || numAmount <= 0 || (isSell ? numAmount > sharesOwned || sharesOwned === 0 : numAmount > balance)}
        className={`w-full py-3 rounded-md text-sm font-semibold transition-all disabled:opacity-25 disabled:cursor-not-allowed ${
          isSell
            ? "bg-white/20 hover:bg-white/30 text-white"
            : side === "YES"
            ? "bg-yes hover:bg-emerald-600 text-white"
            : "bg-no hover:bg-red-600 text-white"
        }`}
      >
        {trade.isPending
          ? (isSell ? "Selling..." : "Placing...")
          : isSell
          ? sharesOwned === 0
            ? `No ${side} shares to sell`
            : numAmount > sharesOwned
            ? "Exceeds shares owned"
            : numAmount <= 0
            ? "Enter shares"
            : `Sell ${numAmount.toFixed(2)} ${side}`
          : numAmount > balance
          ? "Insufficient balance"
          : numAmount <= 0
          ? "Enter amount"
          : `Buy ${side}`}
      </button>
    </div>
  );
}
