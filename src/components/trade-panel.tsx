"use client";

import "@/lib/ensure-server-localstorage";
import { useState, useCallback } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useTrade } from "@/hooks/use-trade";
import { usePortfolio } from "@/hooks/use-portfolio";
import { calculateTradeQuote, calculateSellQuote } from "@/lib/amm";
import { formatUSD, formatPercent } from "@/lib/utils";
import { useAptosAuth } from "./aptos-auth-provider";
import { NavbarWalletControls } from "./navbar-wallet-controls";
import { Toast } from "./toast";

export function TradePanel({
  marketId,
  yesDemand,
  noDemand,
  yesPrice,
  noPrice,
  state,
}: {
  marketId: string;
  yesDemand: number;
  noDemand: number;
  yesPrice: number;
  noPrice: number;
  state: string;
}) {
  const { connected: isConnected } = useWallet();
  const trade = useTrade(marketId);
  const { isAuthenticated, isAuthenticating, authError, signIn } = useAptosAuth();
  const { data: portfolio } = usePortfolio();
  const [direction, setDirection] = useState<"BUY" | "SELL">("BUY");
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  const isSell = direction === "SELL";
  const numAmount = parseFloat(amount) || 0;
  // TEMPORARY: reads v0 DB balance via /api/portfolio. Session D will rewire
  // this to read on-chain VirtualUSD FA balance via src/lib/aptos.ts.
  const balance = portfolio?.balance ?? 0;
  const isOpen = state === "OPEN";

  // Find current position for sell mode
  const currentPosition = portfolio?.positions?.find(
    (p) => p.marketId === marketId && p.side === side
  );
  const sharesOwned = currentPosition ? Number(currentPosition.sharesReceived) : 0;

  const preview = numAmount > 0
    ? isSell
      ? calculateSellQuote(yesDemand, noDemand, side, numAmount)
      : calculateTradeQuote(yesDemand, noDemand, side, numAmount)
    : null;

  const handleTrade = () => {
    if (isSell) {
      if (numAmount <= 0 || numAmount > sharesOwned) return;
    } else {
      if (numAmount <= 0 || numAmount > balance) return;
    }
    trade.mutate(
      { side, amount: numAmount, direction },
      {
        onSuccess: (data) => {
          if (isSell) {
            setToast({ message: `Sold ${numAmount.toFixed(2)} ${side} shares for ${formatUSD(Math.abs(data.amountSpent))}`, type: "success" });
          } else {
            setToast({ message: `Bought ${data.sharesReceived.toFixed(2)} ${side} shares @ ${formatPercent(data.priceAtTrade)}`, type: "success" });
          }
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
