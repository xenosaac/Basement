"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useUser } from "@/hooks/use-user";
import { useBalanceV3 } from "@/hooks/use-balance-v3";
import { useBetV3, BetError, codeToUserMessage } from "@/hooks/use-bet-v3";
import { useSellV3, SellError, sellCodeToUserMessage } from "@/hooks/use-sell-v3";
import { useQuoteV3 } from "@/hooks/use-quote-v3";
import { usePositionsV3 } from "@/hooks/use-positions-v3";
import { useFaucetV3 } from "@/hooks/use-faucet-v3";
import { renderSeriesQuestion, sideLabel } from "@/lib/utils";
import type { BetSide, SeriesId, SeriesSummary } from "@/lib/types/v3-api";

const QUICK_AMOUNTS_CENTS = [100, 500, 1000, 5000];
const SELL_PCT_PRESETS = [25, 50, 75, 100];

function centsToUsd(cents: string | number | null | undefined) {
  if (cents == null || cents === "") return "—";
  return `$${(Number(cents) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCountdown(closeSec: number) {
  const diff = closeSec - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Closing";
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TradePanelV3({
  series,
  initialSide = "UP",
  roundIdx: roundIdxProp,
  caseState,
  resolvedOutcome,
}: {
  series: SeriesSummary;
  initialSide?: BetSide;
  /** Defaults to series.currentRoundIdx (live entry from Markets page).
   *  Pass explicitly when rendering a specific round (Portfolio link → /round/[roundIdx]). */
  roundIdx?: number;
  /** Defaults to "OPEN" (live current round). For historical/resolved rounds,
   *  pass the actual case state so BUY is disabled and SELL works at the
   *  fixed redemption price (handled server-side by /api/sell). */
  caseState?: "OPEN" | "CLOSED" | "RESOLVED" | "VOID";
  resolvedOutcome?: "UP" | "DOWN" | "INVALID" | null;
}) {
  const { connected } = useWallet();
  const user = useUser();
  const address = user.isConnected && user.address ? user.address : undefined;
  const { data: balance } = useBalanceV3(address);
  const { data: positionsData } = usePositionsV3(address);
  const bet = useBetV3();
  const sell = useSellV3();
  const faucet = useFaucetV3();

  // Resolved props with backward-compatible defaults.
  const roundIdx = roundIdxProp ?? series.currentRoundIdx;
  const isCurrentRound = roundIdx === series.currentRoundIdx;
  const state = caseState ?? "OPEN";
  // BUY only makes sense on the live current round in OPEN state.
  // Past rounds + RESOLVED/VOID/CLOSED → SELL-only.
  const canBuy = isCurrentRound && state === "OPEN";

  const [direction, setDirection] = useState<"BUY" | "SELL">(
    canBuy ? "BUY" : "SELL",
  );
  const [side, setSide] = useState<BetSide>(initialSide);
  const [amountCents, setAmountCents] = useState<number>(100);
  const [sellSharesE8, setSellSharesE8] = useState<bigint>(0n);

  useEffect(() => {
    setSide(initialSide);
  }, [initialSide]);

  // If buying isn't allowed, force the SELL tab.
  useEffect(() => {
    if (!canBuy && direction === "BUY") setDirection("SELL");
  }, [canBuy, direction]);

  // Auto-snap side to whichever side the user actually holds on this round —
  // critical for Portfolio → round-detail entry where user may only own DOWN
  // but panel defaults to UP. Only fires once after positions load; manual
  // toggle thereafter wins.
  const [sideAutoSnapped, setSideAutoSnapped] = useState(false);
  useEffect(() => {
    if (sideAutoSnapped || !positionsData) return;
    const onThisRound = positionsData.positions.filter(
      (p) => p.seriesId === series.seriesId && p.roundIdx === roundIdx,
    );
    if (onThisRound.length === 0) {
      setSideAutoSnapped(true);
      return;
    }
    const hasUp = onThisRound.some((p) => p.side === "UP");
    const hasDown = onThisRound.some((p) => p.side === "DOWN");
    if (hasDown && !hasUp) setSide("DOWN");
    else if (hasUp && !hasDown) setSide("UP");
    setSideAutoSnapped(true);
  }, [positionsData, series.seriesId, roundIdx, sideAutoSnapped]);

  // Position for the currently selected side (sell mode source-of-truth)
  const myPosition = useMemo(() => {
    if (!positionsData) return null;
    return (
      positionsData.positions.find(
        (p) =>
          p.seriesId === series.seriesId &&
          p.roundIdx === roundIdx &&
          p.side === side,
      ) ?? null
    );
  }, [positionsData, series.seriesId, roundIdx, side]);

  const positionSharesE8 = myPosition ? BigInt(myPosition.sharesE8) : 0n;

  // Quote — buy uses amountCents, sell uses sharesE8.
  // /api/quote / /api/sell already handle RESOLVED case (fixed 100/0¢) and
  // VOID (cost-basis refund); we just thread the right roundIdx through.
  const quote = useQuoteV3({
    seriesId: series.seriesId as SeriesId,
    roundIdx,
    side,
    amountCents: direction === "BUY" && canBuy ? amountCents : undefined,
    sharesE8: direction === "SELL" && sellSharesE8 > 0n ? sellSharesE8 : undefined,
    enabled: connected && user.isConnected,
  });

  if (!connected) {
    return (
      <div className="glass rounded-lg p-6 text-center">
        <p className="text-sm text-white/60 mb-2">Connect wallet to trade</p>
      </div>
    );
  }
  if (!user.isConnected) {
    return (
      <div className="glass rounded-lg p-6 text-center">
        <p className="text-sm text-white/60">Sign in with wallet to continue</p>
      </div>
    );
  }

  const availableCents = Number(balance?.availableCents ?? 0);
  const canClaimFaucet =
    balance?.nextFaucetAtSec == null ||
    balance.nextFaucetAtSec <= Math.floor(Date.now() / 1000);

  const insufficient = direction === "BUY" && amountCents > availableCents;
  // Market-hours / closing checks only apply to the live current round.
  // For past / resolved rounds, sell is always permitted regardless.
  const marketClosed = isCurrentRound && !series.marketHours.open;
  const roundClosing =
    isCurrentRound &&
    series.currentCloseTimeSec - Math.floor(Date.now() / 1000) <= 5;

  // Action handlers
  function placeBet() {
    bet.mutate({
      seriesId: series.seriesId as SeriesId,
      roundIdx,
      side,
      amountCents,
    });
  }

  function placeSell() {
    if (sellSharesE8 <= 0n || sellSharesE8 > positionSharesE8) return;
    sell.mutate({
      seriesId: series.seriesId as SeriesId,
      roundIdx,
      side,
      sharesE8: sellSharesE8,
    });
  }

  function setSellPct(pct: number) {
    const fraction = BigInt(pct);
    setSellSharesE8((positionSharesE8 * fraction) / 100n);
  }

  const buyError = bet.error instanceof BetError ? bet.error.code : null;
  const sellError = sell.error instanceof SellError ? sell.error.code : null;
  const errorMsg =
    direction === "BUY"
      ? buyError
        ? codeToUserMessage(buyError)
        : null
      : sellError
        ? sellCodeToUserMessage(sellError)
        : null;

  // Live curve prices (always shown, regardless of direction)
  const upPriceCents = quote.data?.upCents ?? 50;
  const downPriceCents = quote.data?.downCents ?? 50;
  const sidePriceCents = side === "UP" ? upPriceCents : downPriceCents;

  // Quote previews
  const buyPreview = quote.data?.buy ?? null;
  const sellPreview = quote.data?.sell ?? null;

  return (
    <div className="glass rounded-lg p-6 space-y-5">
      {/* Balance + faucet */}
      <div>
        <div className="text-[10px] uppercase tracking-[2px] text-white/30 mb-1">
          Balance
        </div>
        <div className="text-2xl font-mono tabular-nums text-white">
          {centsToUsd(balance?.availableCents)}{" "}
          <span className="text-xs text-white/30">vUSD</span>
        </div>
        {canClaimFaucet ? (
          <button
            type="button"
            onClick={() => faucet.mutate()}
            disabled={faucet.isPending}
            className="mt-2 text-xs text-accent hover:underline disabled:opacity-50"
          >
            {faucet.isPending ? "Claiming…" : "Claim $50 from faucet"}
          </button>
        ) : (
          <div className="mt-2 text-xs text-white/30">
            Next faucet in{" "}
            {balance?.nextFaucetAtSec
              ? `${Math.ceil((balance.nextFaucetAtSec - Math.floor(Date.now() / 1000)) / 3600)}h`
              : "—"}
          </div>
        )}
      </div>

      <div className="border-t border-white/[0.06]" />

      {/* BUY / SELL toggle. BUY is hidden when the round can no longer be
          bought (past / resolved / void) — SELL is always available so the
          user can take their winnings (or zero out a losing position). */}
      <div className={`grid gap-2 ${canBuy ? "grid-cols-2" : "grid-cols-1"}`}>
        {canBuy && (
          <button
            type="button"
            onClick={() => setDirection("BUY")}
            className={`py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition ${
              direction === "BUY"
                ? "bg-accent-dim text-accent border border-accent/30"
                : "bg-white/[0.04] text-white/40 border border-transparent hover:border-white/[0.12]"
            }`}
          >
            Buy
          </button>
        )}
        <button
          type="button"
          onClick={() => setDirection("SELL")}
          disabled={positionsData === undefined}
          className={`py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition disabled:opacity-30 ${
            direction === "SELL"
              ? "bg-accent-dim text-accent border border-accent/30"
              : "bg-white/[0.04] text-white/40 border border-transparent hover:border-white/[0.12]"
          }`}
        >
          Sell
        </button>
      </div>

      {/* Round status header. Live rounds show a countdown; resolved / void
          rounds show their final outcome instead. */}
      <div className="text-[10px] uppercase tracking-[2px] text-white/30">
        {isCurrentRound && state === "OPEN" ? (
          <>
            Round {roundIdx} · closes in{" "}
            {formatCountdown(series.currentCloseTimeSec)}
          </>
        ) : state === "RESOLVED" && resolvedOutcome ? (
          <>
            Round {roundIdx} · resolved{" "}
            <span
              className={
                resolvedOutcome === "UP"
                  ? "text-yes"
                  : resolvedOutcome === "DOWN"
                    ? "text-no"
                    : "text-white/40"
              }
            >
              {resolvedOutcome === "INVALID" ? "VOID" : resolvedOutcome} won
            </span>
          </>
        ) : state === "VOID" ? (
          <>Round {roundIdx} · voided · refund at cost</>
        ) : (
          <>Round {roundIdx} · closing</>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSide("UP")}
          className={`py-2.5 rounded-md text-sm font-semibold flex items-center justify-between gap-3 px-3 transition ${
            side === "UP"
              ? "bg-yes-dim text-yes border border-yes-border"
              : "bg-white/[0.04] text-white/50 border border-transparent hover:border-yes-border"
          }`}
        >
          <span>YES</span>
          <span className="text-[11px] text-white/60 font-mono tabular-nums">
            {upPriceCents}¢
          </span>
        </button>
        <button
          type="button"
          onClick={() => setSide("DOWN")}
          className={`py-2.5 rounded-md text-sm font-semibold flex items-center justify-between gap-3 px-3 transition ${
            side === "DOWN"
              ? "bg-no-dim text-no border border-no-border"
              : "bg-white/[0.04] text-white/50 border border-transparent hover:border-no-border"
          }`}
        >
          <span>NO</span>
          <span className="text-[11px] text-white/60 font-mono tabular-nums">
            {downPriceCents}¢
          </span>
        </button>
      </div>

      {/* BUY mode form */}
      {direction === "BUY" && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {QUICK_AMOUNTS_CENTS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setAmountCents(c)}
                className={`py-2 text-xs rounded-md transition ${
                  amountCents === c
                    ? "bg-accent-dim text-accent border border-accent/30"
                    : "bg-white/[0.04] text-white/50 border border-transparent hover:border-white/[0.12]"
                }`}
              >
                ${c / 100}
              </button>
            ))}
          </div>
          <input
            type="number"
            step="0.01"
            min="0.10"
            value={amountCents / 100}
            onChange={(e) =>
              setAmountCents(
                Math.max(10, Math.round(parseFloat(e.target.value || "0") * 100)),
              )
            }
            className="w-full px-3 py-2.5 bg-black/30 border border-white/[0.08] rounded-md text-white text-sm tabular-nums focus:outline-none focus:border-accent"
            placeholder="Amount vUSD"
          />
          {/* Live buy quote */}
          {buyPreview && (
            <div className="text-[11px] text-white/50 grid grid-cols-2 gap-1 px-1">
              <div>Shares</div>
              <div className="text-right font-mono tabular-nums">
                {(Number(buyPreview.sharesE8) / 1e8).toFixed(2)}
              </div>
              <div>Avg price</div>
              <div className="text-right font-mono tabular-nums">
                {buyPreview.avgPriceCents}¢
              </div>
              <div>If {sideLabel(side)} wins</div>
              <div className="text-right font-mono tabular-nums text-yes">
                {centsToUsd(
                  ((BigInt(buyPreview.sharesE8) * 100n) / 100_000_000n).toString(),
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SELL mode form */}
      {direction === "SELL" && (
        <div className="space-y-3">
          {positionSharesE8 === 0n ? (
            <div className="text-xs text-white/40 text-center py-4">
              No {sideLabel(side)} position to sell on this round.
            </div>
          ) : (
            <>
              <div className="text-[11px] text-white/50 px-1 flex justify-between">
                <span>Holding</span>
                <span className="font-mono tabular-nums">
                  {(Number(positionSharesE8) / 1e8).toFixed(4)} sh ·{" "}
                  {centsToUsd(myPosition?.markValueCents)} mark
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {SELL_PCT_PRESETS.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setSellPct(pct)}
                    className="py-2 text-xs rounded-md bg-white/[0.04] text-white/50 border border-transparent hover:border-white/[0.12] transition"
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              <input
                type="number"
                step="0.0001"
                min="0"
                max={Number(positionSharesE8) / 1e8}
                value={Number(sellSharesE8) / 1e8}
                onChange={(e) => {
                  const sh = parseFloat(e.target.value || "0");
                  const e8 = BigInt(Math.max(0, Math.round(sh * 1e8)));
                  setSellSharesE8(e8 > positionSharesE8 ? positionSharesE8 : e8);
                }}
                className="w-full px-3 py-2.5 bg-black/30 border border-white/[0.08] rounded-md text-white text-sm tabular-nums focus:outline-none focus:border-accent"
                placeholder="Shares to sell"
              />
              {sellPreview && sellSharesE8 > 0n && (
                <div className="text-[11px] text-white/50 grid grid-cols-2 gap-1 px-1">
                  <div>Proceeds</div>
                  <div className="text-right font-mono tabular-nums text-accent">
                    {centsToUsd(sellPreview.proceedsCents)}
                  </div>
                  <div>Price/share</div>
                  <div className="text-right font-mono tabular-nums">
                    {sellPreview.pricePerShareCents}¢
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {errorMsg && (
        <div className="text-xs text-no bg-no-dim rounded-md px-3 py-2">
          {errorMsg}
        </div>
      )}

      {direction === "BUY" ? (
        <button
          type="button"
          onClick={placeBet}
          disabled={
            bet.isPending ||
            insufficient ||
            marketClosed ||
            roundClosing ||
            amountCents < 10
          }
          className="w-full py-3 rounded-md bg-accent text-black text-sm font-semibold hover:shadow-glow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {bet.isPending
            ? "Placing…"
            : marketClosed
              ? "Market Closed"
              : roundClosing
                ? "Round Closing…"
                : insufficient
                  ? "Insufficient Balance"
                  : `Buy ${sideLabel(side)} for $${(amountCents / 100).toFixed(2)}`}
        </button>
      ) : (
        <button
          type="button"
          onClick={placeSell}
          disabled={
            sell.isPending ||
            sellSharesE8 <= 0n ||
            sellSharesE8 > positionSharesE8 ||
            // Block sells during the 5s pre-close window on the live round.
            (isCurrentRound && state === "OPEN" && (roundClosing || marketClosed)) ||
            // CLOSED is the brief settling window before RESOLVED — sell route
            // also rejects with ROUND_CLOSED, so disable here for parity.
            state === "CLOSED"
          }
          className="w-full py-3 rounded-md bg-accent text-black text-sm font-semibold hover:shadow-glow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sell.isPending
            ? "Selling…"
            : state === "CLOSED"
              ? "Settling…"
              : isCurrentRound && state === "OPEN" && roundClosing
                ? "Round Closing…"
                : sellSharesE8 <= 0n
                  ? positionSharesE8 === 0n
                    ? "No shares to sell"
                    : "Enter shares to sell"
                  : `Sell ${(Number(sellSharesE8) / 1e8).toFixed(2)} ${sideLabel(side)}`}
        </button>
      )}

      <div className="text-[10px] text-white/30 text-center leading-relaxed">
        {renderSeriesQuestion({
          pair: series.pair,
          cadenceSec: series.cadenceSec,
          strikeKind: series.strikeKind,
          strikePriceE8: series.strikePriceE8,
          priceExpo: series.priceExpo,
        })}
        <br />
        Paradigm pm-AMM curve · sell anytime before resolve · winners get $1/share
      </div>
    </div>
  );
}
