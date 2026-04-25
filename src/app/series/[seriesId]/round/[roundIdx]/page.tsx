"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { useOddsCurveV3 } from "@/hooks/use-odds-curve-v3";
import { useSellV3, SellError, sellCodeToUserMessage } from "@/hooks/use-sell-v3";
import { ProbabilityChart } from "@/components/probability-chart";
import { renderSeriesQuestion, sideLabel, outcomeLabel } from "@/lib/utils";
import type { SeriesId, BetSide } from "@/lib/types/v3-api";

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

function ResolvedSellPanel({
  seriesId,
  roundIdx,
  state,
  resolvedOutcome,
  positions,
}: {
  seriesId: string;
  roundIdx: number;
  state: "OPEN" | "CLOSED" | "RESOLVED" | "VOID";
  resolvedOutcome: "UP" | "DOWN" | "INVALID" | null;
  positions: Array<{
    side: "UP" | "DOWN";
    sharesE8: string;
    costBasisCents: string;
  }>;
}) {
  const sell = useSellV3();
  return (
    <div className="mb-6">
      <h2 className="text-xs uppercase tracking-wider mb-3 text-accent flex items-center gap-2">
        Your shares — sell to redeem
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
      </h2>
      <div className="space-y-2">
        {positions.map((p) => {
          const shares = BigInt(p.sharesE8);
          const sharesNum = Number(shares) / 1e8;
          const cost = Number(p.costBasisCents);
          const winning =
            state === "VOID"
              ? true
              : resolvedOutcome === p.side;
          const pricePerShareCents =
            state === "VOID" ? Math.round((cost / sharesNum) * 1) : winning ? 100 : 0;
          // Proceeds: void = pro-rata cost basis, else shares × price
          const proceedsCents =
            state === "VOID"
              ? cost
              : Math.round(sharesNum * pricePerShareCents);
          const profit = proceedsCents - cost;
          const isPending =
            sell.isPending &&
            sell.variables?.side === p.side &&
            sell.variables?.roundIdx === roundIdx;
          return (
            <div
              key={p.side}
              className="glass rounded-lg px-4 py-3 flex items-center justify-between gap-4 text-sm"
            >
              <span
                className={`text-xs font-semibold uppercase ${p.side === "UP" ? "text-yes" : "text-no"}`}
              >
                {sideLabel(p.side)}
              </span>
              <span className="text-white/70 font-mono tabular-nums flex-1 text-right">
                {sharesNum.toFixed(2)} sh @{" "}
                {state === "VOID" ? "refund" : `${pricePerShareCents}¢`}
              </span>
              <span
                className={`text-xs font-mono tabular-nums ${
                  profit > 0
                    ? "text-yes"
                    : profit < 0
                      ? "text-no"
                      : "text-white/40"
                }`}
              >
                {profit >= 0 ? "+" : ""}
                ${(profit / 100).toFixed(2)}
              </span>
              {winning || state === "VOID" ? (
                <button
                  type="button"
                  onClick={() =>
                    sell.mutate({
                      seriesId: seriesId as SeriesId,
                      roundIdx,
                      side: p.side as BetSide,
                      sharesE8: shares,
                    })
                  }
                  disabled={sell.isPending}
                  className="px-3 py-1.5 rounded-md bg-accent text-black text-xs font-semibold hover:shadow-glow-sm transition disabled:opacity-50"
                >
                  {isPending
                    ? "Selling…"
                    : `Sell $${(proceedsCents / 100).toFixed(2)}`}
                </button>
              ) : (
                <span className="text-xs text-white/30">No value</span>
              )}
            </div>
          );
        })}
      </div>
      {sell.error instanceof SellError && (
        <div className="mt-2 text-xs text-no">
          {sellCodeToUserMessage(sell.error.code)}
        </div>
      )}
    </div>
  );
}

function RoundOddsChart({
  seriesId,
  roundIdx,
}: {
  seriesId: string;
  roundIdx: number;
}) {
  const { data } = useOddsCurveV3(seriesId, roundIdx);
  if (!data) return null;
  return (
    <div className="glass rounded-lg p-4 mb-6">
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

function pythE8ToUsd(e8: string | null) {
  if (!e8) return "—";
  return `$${(Number(e8) / 1e8).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function RoundDetailPage() {
  const { seriesId, roundIdx } = useParams<{ seriesId: string; roundIdx: string }>();
  const user = useUser();
  const address = user.isConnected && user.address ? user.address : undefined;

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
      <div className="max-w-3xl mx-auto px-4 py-8 animate-pulse space-y-4">
        <div className="h-6 bg-white/5 rounded w-1/3" />
        <div className="h-32 bg-white/5 rounded-lg" />
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

  const isResolved = data.state === "RESOLVED";
  const isVoid = data.state === "VOID";
  const winnerSide = data.resolvedOutcome === "UP" ? "UP" : data.resolvedOutcome === "DOWN" ? "DOWN" : null;

  // Strike → resolve delta
  const strike = data.strikeCents != null ? Number(data.strikeCents) : null;
  const resolveCents =
    data.resolvedPriceE8 != null ? Number(data.resolvedPriceE8) / 1e6 : null; // pyth e8 → cents
  const deltaCents = strike != null && resolveCents != null ? resolveCents - strike : null;

  const myTotalPaid = data.myOrders
    .filter((o) => o.isBuy === 1)
    .reduce((s, o) => s + Number(o.amountCents), 0);
  const myTotalReceived = data.myOrders
    .reduce((s, o) => s + Number(o.payoutCents ?? 0) + (o.isBuy === 0 ? Number(o.amountCents) : 0) - (o.isBuy === 0 ? Number(o.payoutCents ?? 0) : 0), 0);
  // simpler: sum payoutCents (already set on every settled / sold row)
  const myNetCents = data.myOrders.reduce(
    (s, o) => {
      // For buy: payoutCents - cost(amountCents). Cost is amountCents.
      // For sell: payoutCents already = proceeds (no extra cost since shares were already paid for in buy row)
      if (o.isBuy === 1) return s + Number(o.payoutCents ?? 0) - Number(o.amountCents);
      return s + Number(o.payoutCents ?? 0); // sell proceeds; cost already counted in buy row
    },
    0,
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link
          href={`/series/${data.seriesId}`}
          className="text-xs text-white/40 hover:text-white/70 uppercase tracking-[2px]"
        >
          ← {data.pair ?? data.seriesId}
        </Link>
        <div className="text-xs uppercase tracking-[2px] text-white/40 mt-2 mb-1">
          Round {data.roundIdx}
          {" · "}
          <span
            className={
              isResolved
                ? winnerSide === "UP"
                  ? "text-yes"
                  : "text-no"
                : isVoid
                  ? "text-amber-300/80"
                  : "text-accent"
            }
          >
            {isVoid ? "VOID" : isResolved ? `${winnerSide} won` : "OPEN"}
          </span>
        </div>
        <h1 className="text-xl font-semibold text-white leading-snug">
          {data.pair && data.cadenceSec
            ? renderSeriesQuestion({ pair: data.pair, cadenceSec: data.cadenceSec })
            : `${data.seriesId} · Round ${data.roundIdx}`}
        </h1>
        <div className="text-xs text-white/40 mt-2">
          Closed {new Date(data.closeTimeSec * 1000).toLocaleString()}
        </div>
      </div>

      <RoundOddsChart seriesId={data.seriesId} roundIdx={data.roundIdx} />

      {/* Strike vs resolve */}
      <div className="glass rounded-lg p-5 mb-6 grid grid-cols-3 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[2px] text-white/30 mb-1">Strike</div>
          <div className="text-lg font-mono tabular-nums text-white/90">
            {centsToUsd(data.strikeCents)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[2px] text-white/30 mb-1">
            {isResolved || isVoid ? "Settle price" : "Live"}
          </div>
          <div className="text-lg font-mono tabular-nums text-white/90">
            {pythE8ToUsd(data.resolvedPriceE8)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[2px] text-white/30 mb-1">Δ</div>
          <div
            className={`text-lg font-mono tabular-nums ${
              deltaCents == null
                ? "text-white/40"
                : deltaCents > 0
                  ? "text-yes"
                  : deltaCents < 0
                    ? "text-no"
                    : "text-white/40"
            }`}
          >
            {deltaCents == null
              ? "—"
              : `${deltaCents >= 0 ? "+" : ""}${centsToUsd(deltaCents)}`}
          </div>
        </div>
      </div>

      {/* Pool snapshot */}
      <div className="glass rounded-lg p-5 mb-6">
        <div className="text-[10px] uppercase tracking-[2px] text-white/30 mb-3">
          Pool at {isResolved || isVoid ? "settle" : "now"}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md bg-yes-dim border border-yes-border p-3 text-center">
            <div className="text-[10px] uppercase tracking-[2px] text-yes mb-1">YES total stake</div>
            <div className="text-base font-mono tabular-nums text-yes">
              {centsToUsd(data.upPoolCents)}
            </div>
            {data.livePrices && (
              <div className="text-[10px] text-yes/70 mt-1">{data.livePrices.upCents}¢ now</div>
            )}
          </div>
          <div className="rounded-md bg-no-dim border border-no-border p-3 text-center">
            <div className="text-[10px] uppercase tracking-[2px] text-no mb-1">NO total stake</div>
            <div className="text-base font-mono tabular-nums text-no">
              {centsToUsd(data.downPoolCents)}
            </div>
            {data.livePrices && (
              <div className="text-[10px] text-no/70 mt-1">{data.livePrices.downCents}¢ now</div>
            )}
          </div>
        </div>
      </div>

      {/* Sell controls for any positions still held (post-resolve redemption) */}
      {data.myPositions.length > 0 && (isResolved || isVoid) && (
        <ResolvedSellPanel
          seriesId={data.seriesId}
          roundIdx={data.roundIdx}
          state={data.state}
          resolvedOutcome={data.resolvedOutcome}
          positions={data.myPositions}
        />
      )}

      {/* My orders for this round */}
      {data.myOrders.length > 0 ? (
        <div>
          <h2 className="text-xs text-white/35 uppercase tracking-wider mb-3">
            Your trades ({data.myOrders.length})
          </h2>
          <div className="space-y-2 mb-4">
            {data.myOrders.map((o) => {
              const isBuy = o.isBuy === 1;
              const payout = o.payoutCents != null ? Number(o.payoutCents) : null;
              const cost = isBuy ? Number(o.amountCents) : 0;
              const profit = payout != null ? payout - cost : null;
              return (
                <div
                  key={o.orderId}
                  className="glass rounded-lg px-4 py-3 flex items-center justify-between gap-4 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-[10px] uppercase font-semibold tracking-wider ${
                        isBuy ? "text-accent" : "text-white/60"
                      }`}
                    >
                      {isBuy ? "Buy" : "Sell"}
                    </span>
                    <span
                      className={`text-xs font-semibold uppercase ${o.side === "UP" ? "text-yes" : "text-no"}`}
                    >
                      {sideLabel(o.side)}
                    </span>
                  </div>
                  <span className="text-xs text-white/40 font-mono tabular-nums">
                    {isBuy ? "−" : "+"}
                    {centsToUsd(isBuy ? o.amountCents : o.amountCents)}
                  </span>
                  <span
                    className={`text-xs font-mono tabular-nums ${
                      profit == null
                        ? "text-white/30"
                        : profit > 0
                          ? "text-yes"
                          : profit < 0
                            ? "text-no"
                            : "text-white/40"
                    }`}
                  >
                    {payout == null
                      ? "pending"
                      : isBuy
                        ? `→ ${centsToUsd(payout)}`
                        : centsToUsd(payout)}
                  </span>
                </div>
              );
            })}
          </div>
          {(isResolved || isVoid) && (
            <div className="glass rounded-lg px-4 py-3 flex items-center justify-between text-sm">
              <span className="text-xs uppercase tracking-wider text-white/35">
                Net P&L this round
              </span>
              <span
                className={`text-base font-mono tabular-nums ${
                  myNetCents > 0
                    ? "text-yes"
                    : myNetCents < 0
                      ? "text-no"
                      : "text-white/40"
                }`}
              >
                {myNetCents >= 0 ? "+" : ""}
                {centsToUsd(myNetCents)}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-white/40 text-sm">
          {address ? "You did not trade this round." : "Sign in to see your trades."}
        </div>
      )}

      {isResolved && (
        <div className="text-[11px] text-white/30 text-center mt-6">
          Outcome: {outcomeLabel(data.resolvedOutcome) ?? "—"} · winners get $1.00 / share
        </div>
      )}
    </div>
  );
}
