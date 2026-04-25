"use client";

/**
 * Round detail page — same Polymarket-style layout as the live series page
 * (left 2/3: chart + price/pool cards + your trades + activity, right 1/3:
 * sticky TradePanelV3) but bound to a specific roundIdx from the URL and
 * pulling round-specific data from /api/case. Used by Portfolio "open
 * position" / "resolved" links to land on the round the user holds, with
 * the same trading UI they get from the Markets card.
 *
 * TradePanelV3's roundIdx + caseState + resolvedOutcome props gate BUY off
 * for past or resolved rounds; SELL is always available (curve quote when
 * OPEN, fixed 100/0¢ on RESOLVED, cost-basis refund on VOID).
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSeriesV3 } from "@/hooks/use-series-v3";
import { useUser } from "@/hooks/use-user";
import { useActivityV3 } from "@/hooks/use-activity-v3";
import { useOddsCurveV3 } from "@/hooks/use-odds-curve-v3";
import { TradePanelV3 } from "@/components/trade-panel-v3";
import { ProbabilityChart } from "@/components/probability-chart";
import { renderSeriesQuestion, sideLabel } from "@/lib/utils";

interface CaseDetail {
  seriesId: string;
  roundIdx: number;
  pair: string | null;
  cadenceSec: number | null;
  startTimeSec: number;
  closeTimeSec: number;
  strikePriceE8: string | null;
  strikeCents: string | null;
  resolvedPriceE8: string | null;
  resolvedOutcome: "UP" | "DOWN" | "INVALID" | null;
  resolvedAt: string | null;
  state: "OPEN" | "CLOSED" | "RESOLVED" | "VOID";
  upPoolCents: string;
  downPoolCents: string;
  upSharesE8: string;
  downSharesE8: string;
  livePrices: { upCents: number; downCents: number } | null;
  myPositions: Array<{
    side: "UP" | "DOWN";
    sharesE8: string;
    costBasisCents: string;
    realizedPnlCents: string;
  }>;
  myOrders: Array<{
    orderId: string;
    side: "UP" | "DOWN";
    amountCents: string;
    sharesE8: string | null;
    isBuy: number;
    placedAtSec: number;
    payoutCents: string | null;
  }>;
}

function centsToUsd(cents: string | number | null | undefined) {
  if (cents == null || cents === "") return "—";
  return `$${(Number(cents) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pythE8ToUsdString(e8: string | null): string | null {
  if (!e8) return null;
  // Convert Pyth e8 → cents (cents = e8 / 1e6, then /100 = USD).
  return ((Number(e8) / 1e6) | 0).toString();
}

/**
 * pm-AMM probability chart card. Replays orders for the round and polls
 * every 4s while OPEN. Matches the series-page version verbatim.
 */
function OddsChartCard({
  seriesId,
  roundIdx,
}: {
  seriesId: string;
  roundIdx: number;
}) {
  const { data, isLoading } = useOddsCurveV3(seriesId, roundIdx);
  if (isLoading || !data) {
    return (
      <div className="glass rounded-lg p-4 h-[220px] animate-pulse bg-white/[0.03]" />
    );
  }
  return (
    <div className="glass rounded-lg p-4">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[2px] text-white/30 mb-2 px-1">
        <span>Probability over time</span>
        <span className="flex items-center gap-3">
          <span className="text-yes">YES {data.current.upCents}%</span>
          <span className="text-no">NO {data.current.downCents}%</span>
        </span>
      </div>
      <ProbabilityChart
        points={data.points}
        startTimeSec={data.startTimeSec}
        closeTimeSec={data.closeTimeSec}
        state={data.state}
        resolvedOutcome={data.resolvedOutcome}
        height={200}
      />
    </div>
  );
}

/** Anonymized peer trades for this round. Same component as series page. */
function RoundActivity({
  seriesId,
  roundIdx,
  nowMs,
}: {
  seriesId: string;
  roundIdx: number;
  nowMs: number;
}) {
  const { data } = useActivityV3(seriesId, roundIdx, 20);
  const trades = data?.trades ?? [];
  if (trades.length === 0) {
    return (
      <div>
        <h2 className="text-xs text-white/35 uppercase tracking-wider mb-3">
          Live Activity
        </h2>
        <div className="glass rounded-lg px-4 py-6 text-center text-xs text-white/30">
          No trades on this round yet.
        </div>
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-xs text-white/35 uppercase tracking-wider mb-3 flex items-center gap-2">
        Live Activity
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
      </h2>
      <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
        {trades.map((t) => {
          const ago = Math.max(0, Math.floor(nowMs / 1000) - t.placedAtSec);
          const agoLabel = ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)}m`;
          const shares = t.sharesE8 ? Number(t.sharesE8) / 1e8 : null;
          return (
            <div
              key={t.orderId}
              className="glass rounded-lg px-3 py-2 flex items-center justify-between text-xs gap-3"
            >
              <span className="text-white/35 font-mono w-20 truncate">
                {t.anonAddress}
              </span>
              <span
                className={`uppercase font-semibold tracking-wider w-10 text-center ${
                  t.isBuy === 1 ? "text-accent" : "text-white/60"
                }`}
              >
                {t.isBuy === 1 ? "Buy" : "Sell"}
              </span>
              <span
                className={`uppercase font-semibold w-8 text-center ${
                  t.side === "UP" ? "text-yes" : "text-no"
                }`}
              >
                {t.side === "UP" ? "YES" : "NO"}
              </span>
              <span className="text-white/70 font-mono tabular-nums flex-1 text-right">
                {shares != null && `${shares.toFixed(2)} sh · `}
                {centsToUsd(t.amountCents)}
              </span>
              <span className="text-white/30 font-mono tabular-nums w-10 text-right">
                {agoLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function RoundDetailPage() {
  const { seriesId, roundIdx } = useParams<{
    seriesId: string;
    roundIdx: string;
  }>();
  const roundIdxNum = Number(roundIdx);
  const user = useUser();
  const address = user.isConnected && user.address ? user.address : undefined;

  const { data: seriesList } = useSeriesV3();
  const series = seriesList?.series.find((s) => s.seriesId === seriesId);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading, error } = useQuery<CaseDetail>({
    queryKey: ["case-detail", seriesId, roundIdx, address],
    queryFn: async () => {
      const sp = new URLSearchParams({ seriesId, roundIdx });
      if (address) sp.set("user", address);
      const res = await fetch(`/api/case?${sp.toString()}`);
      if (!res.ok) throw new Error(`case fetch failed (${res.status})`);
      return res.json();
    },
    refetchInterval: (q) =>
      q.state.data?.state === "OPEN" ? 4_000 : false,
  });

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 animate-pulse space-y-4">
        <div className="h-8 bg-white/5 rounded w-3/4" />
        <div className="h-64 bg-white/5 rounded-lg" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="text-center py-20 text-white/40">
        Round not found.
        <div className="mt-4">
          <Link href="/markets" className="text-accent hover:underline">
            ← Back to markets
          </Link>
        </div>
      </div>
    );
  }

  const isOpen = data.state === "OPEN";
  const isResolved = data.state === "RESOLVED";
  const isVoid = data.state === "VOID";
  const winnerSide =
    data.resolvedOutcome === "UP"
      ? "UP"
      : data.resolvedOutcome === "DOWN"
        ? "DOWN"
        : null;

  // Live or settle countdown / status text — mirrors the series page header.
  const diffSec = data.closeTimeSec - Math.floor(nowMs / 1000);
  const countdown =
    isOpen
      ? diffSec <= 0
        ? "Closing…"
        : `${Math.floor(diffSec / 60)}:${(diffSec % 60).toString().padStart(2, "0")}`
      : isResolved
        ? `${winnerSide} won`
        : isVoid
          ? "VOID"
          : "Closed";

  // Map case fields onto the same shapes the series page uses for its cards.
  // livePrices is only populated while OPEN; for RESOLVED rounds we fall
  // back to the fixed redemption price (winner = 100¢, loser = 0¢).
  const upCents = data.livePrices?.upCents ?? (winnerSide === "UP" ? 100 : 0);
  const downCents = data.livePrices?.downCents ?? (winnerSide === "DOWN" ? 100 : 0);
  // "Live price" in the series-page card was the underlying spot. For round
  // page: show resolved settle price if RESOLVED, else current Pyth tick
  // (which the API doesn't expose directly here — leave null gracefully).
  const livePriceCents =
    isResolved || isVoid ? pythE8ToUsdString(data.resolvedPriceE8) : null;
  const totalPoolStr = (
    BigInt(data.upPoolCents) + BigInt(data.downPoolCents)
  ).toString();

  // Strike vs spot Δ — only meaningful when both prices are known.
  const strikeNum =
    data.strikeCents != null ? Number(data.strikeCents) : null;
  const liveNum =
    livePriceCents != null ? Number(livePriceCents) : null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link
          href="/markets"
          className="text-xs text-white/40 hover:text-white/70 uppercase tracking-[2px]"
        >
          ← Markets
        </Link>
        <div className="text-xs uppercase tracking-[2px] text-white/40 mt-2 mb-1">
          {data.pair ?? data.seriesId}
        </div>
        <h1 className="text-2xl font-bold text-white leading-snug">
          {data.pair && data.cadenceSec
            ? renderSeriesQuestion({
                pair: data.pair,
                cadenceSec: data.cadenceSec,
              })
            : `${data.seriesId} · Round ${data.roundIdx}`}
        </h1>
        <div className="flex items-center gap-3 mt-2 text-xs text-white/40">
          <span>Round {data.roundIdx}</span>
          <span>·</span>
          <span
            className={`font-mono tabular-nums ${
              isOpen
                ? "text-accent"
                : isResolved && winnerSide === "UP"
                  ? "text-yes"
                  : isResolved && winnerSide === "DOWN"
                    ? "text-no"
                    : "text-amber-300/80"
            }`}
          >
            {countdown}
          </span>
          <span>·</span>
          <span>
            {data.cadenceSec === 180
              ? "3-min"
              : data.cadenceSec === 900
                ? "15-min"
                : data.cadenceSec === 3600
                  ? "1-hour"
                  : "round"}{" "}
            rounds
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <OddsChartCard seriesId={data.seriesId} roundIdx={data.roundIdx} />
          <div className="glass rounded-lg p-6">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-[2px] text-white/30 mb-1">
                  {isResolved || isVoid ? "Settle price" : "Live price"}
                </div>
                <div className="text-xl font-mono tabular-nums text-accent">
                  {centsToUsd(livePriceCents)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[2px] text-white/30 mb-1">
                  {isResolved || isVoid ? "Pool at settle" : "Total Pool"}
                </div>
                <div className="text-xl font-mono tabular-nums text-white">
                  {centsToUsd(totalPoolStr)}
                </div>
              </div>
            </div>
            {/* Spot · Strike · Δ — absolute prices, no derived %. */}
            {liveNum != null && strikeNum != null && (
              <div className="text-[11px] uppercase tracking-[2px] text-white/40 mb-4 font-mono tabular-nums">
                Spot {centsToUsd(liveNum)}
                <span className="text-white/20"> · </span>
                Strike {centsToUsd(strikeNum)}
                <span className="text-white/20"> · </span>
                Δ {centsToUsd(Math.abs(liveNum - strikeNum))}{" "}
                {isResolved || isVoid ? "at settle" : "to trigger"}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-md bg-yes-dim border border-yes-border p-4 text-center">
                <div className="text-[10px] uppercase tracking-[2px] text-yes mb-1">
                  YES
                </div>
                <div className="text-2xl font-mono tabular-nums text-yes">
                  {upCents}%
                </div>
              </div>
              <div className="rounded-md bg-no-dim border border-no-border p-4 text-center">
                <div className="text-[10px] uppercase tracking-[2px] text-no mb-1">
                  NO
                </div>
                <div className="text-2xl font-mono tabular-nums text-no">
                  {downCents}%
                </div>
              </div>
            </div>
          </div>

          {data.myOrders.length > 0 && (
            <div>
              <h2 className="text-xs text-white/35 uppercase tracking-wider mb-3">
                Your Trades This Round
              </h2>
              <div className="space-y-2">
                {data.myOrders.map((o) => {
                  const shares = o.sharesE8
                    ? Number(o.sharesE8) / 1e8
                    : null;
                  return (
                    <div
                      key={o.orderId}
                      className="glass rounded-lg px-4 py-3 flex items-center justify-between gap-3 text-sm"
                    >
                      <span
                        className={`text-xs font-semibold uppercase tracking-wider w-10 text-center ${
                          o.isBuy === 1 ? "text-accent" : "text-white/60"
                        }`}
                      >
                        {o.isBuy === 1 ? "BUY" : "SELL"}
                      </span>
                      <span
                        className={`text-xs font-semibold uppercase ${o.side === "UP" ? "text-yes" : "text-no"}`}
                      >
                        {sideLabel(o.side)}
                      </span>
                      <span className="text-white/70 font-mono tabular-nums flex-1 text-right">
                        {shares != null && `${shares.toFixed(2)} sh · `}
                        ${(Number(o.amountCents) / 100).toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <RoundActivity
            seriesId={data.seriesId}
            roundIdx={data.roundIdx}
            nowMs={nowMs}
          />
        </div>

        <div>
          {series && (
            <div className="lg:sticky lg:top-6">
              <TradePanelV3
                series={series}
                roundIdx={roundIdxNum}
                caseState={data.state}
                resolvedOutcome={data.resolvedOutcome}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
