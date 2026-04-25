"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSeriesV3 } from "@/hooks/use-series-v3";
import { useUser } from "@/hooks/use-user";
import { useOrdersV3 } from "@/hooks/use-orders-v3";
import { useActivityV3 } from "@/hooks/use-activity-v3";
import { useOddsCurveV3 } from "@/hooks/use-odds-curve-v3";
import { TradePanelV3 } from "@/components/trade-panel-v3";
import { ProbabilityChart } from "@/components/probability-chart";
import { renderSeriesQuestion, sideLabel } from "@/lib/utils";
import type { BetSide } from "@/lib/types/v3-api";

function centsToUsd(cents: string | null | undefined) {
  if (!cents) return "—";
  return `$${(Number(cents) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * pm-AMM probability chart card. Replays orders for the current round and
 * polls every 4s while OPEN.
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

/**
 * Live activity feed for the CURRENT round only — explicitly does not bleed
 * past rounds (each round is a separate game). Anonymized peer trades.
 */
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
          No trades on this round yet — be the first.
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

export default function SeriesDetailPage() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const sideParam = searchParams.get("side");
  const initialSide: BetSide =
    sideParam === "DOWN" ? "DOWN" : "UP";
  const { data, isLoading } = useSeriesV3();
  const user = useUser();
  const address = user.isConnected && user.address ? user.address : undefined;
  const { data: ordersData } = useOrdersV3(address);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const series = data?.series.find((s) => s.seriesId === seriesId);

  // When the round you've been watching closes AND you have orders on it,
  // navigate to the historical detail page so you can see the outcome and
  // claim from Portfolio. Anonymous viewers / no-position lurkers silently
  // advance to the new round (no nav).
  const watchedRoundRef = useRef<number | null>(null);
  useEffect(() => {
    if (!series) return;
    if (watchedRoundRef.current === null) {
      watchedRoundRef.current = series.currentRoundIdx;
      return;
    }
    if (series.currentRoundIdx > watchedRoundRef.current) {
      const closedRound = watchedRoundRef.current;
      const hadPosition = (ordersData?.orders ?? []).some(
        (o) => o.seriesId === seriesId && o.roundIdx === closedRound,
      );
      if (hadPosition) {
        router.replace(`/series/${seriesId}/round/${closedRound}`);
        return;
      }
      // Lurker without position — silently follow the live round.
      watchedRoundRef.current = series.currentRoundIdx;
    }
  }, [series, seriesId, router, ordersData]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 animate-pulse space-y-4">
        <div className="h-8 bg-white/5 rounded w-3/4" />
        <div className="h-64 bg-white/5 rounded-lg" />
      </div>
    );
  }
  if (!series) {
    return (
      <div className="text-center py-20 text-white/40">
        Series not found.
        <div className="mt-4">
          <Link href="/markets" className="text-accent hover:underline">
            ← Back to markets
          </Link>
        </div>
      </div>
    );
  }

  const diffSec = series.currentCloseTimeSec - Math.floor(nowMs / 1000);
  const countdown =
    diffSec <= 0
      ? "Closing…"
      : `${Math.floor(diffSec / 60)}:${(diffSec % 60).toString().padStart(2, "0")}`;

  const myRoundOrders = (ordersData?.orders ?? []).filter(
    (o) => o.seriesId === seriesId && o.roundIdx === series.currentRoundIdx,
  );

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
          {series.pair}
        </div>
        <h1 className="text-2xl font-bold text-white leading-snug">
          {renderSeriesQuestion({ pair: series.pair, cadenceSec: series.cadenceSec })}
        </h1>
        <div className="flex items-center gap-3 mt-2 text-xs text-white/40">
          <span>Round {series.currentRoundIdx}</span>
          <span>·</span>
          <span className="text-accent font-mono tabular-nums">{countdown}</span>
          <span>·</span>
          <span>{series.cadenceSec === 180 ? "3-min" : "1-hour"} rounds</span>
          {!series.marketHours.open && (
            <>
              <span>·</span>
              <span className="text-amber-300/80">
                Closed ({series.marketHours.reason})
              </span>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <OddsChartCard
            seriesId={seriesId}
            roundIdx={series.currentRoundIdx}
          />
          <div className="glass rounded-lg p-6">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-[2px] text-white/30 mb-1">
                  Live price
                </div>
                <div className="text-xl font-mono tabular-nums text-accent">
                  {centsToUsd(series.currentPriceCents)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[2px] text-white/30 mb-1">
                  Total Pool
                </div>
                <div className="text-xl font-mono tabular-nums text-white">
                  {centsToUsd(
                    (
                      BigInt(series.currentUpPoolCents) +
                      BigInt(series.currentDownPoolCents)
                    ).toString(),
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-md bg-yes-dim border border-yes-border p-4 text-center">
                <div className="text-[10px] uppercase tracking-[2px] text-yes mb-1">
                  YES
                </div>
                <div className="text-2xl font-mono tabular-nums text-yes">
                  {series.currentUpPriceCents}%
                </div>
              </div>
              <div className="rounded-md bg-no-dim border border-no-border p-4 text-center">
                <div className="text-[10px] uppercase tracking-[2px] text-no mb-1">
                  NO
                </div>
                <div className="text-2xl font-mono tabular-nums text-no">
                  {series.currentDownPriceCents}%
                </div>
              </div>
            </div>
          </div>

          {myRoundOrders.length > 0 && (
            <div>
              <h2 className="text-xs text-white/35 uppercase tracking-wider mb-3">
                Your Trades This Round
              </h2>
              <div className="space-y-2">
                {myRoundOrders.map((o) => {
                  const shares = o.sharesE8 ? Number(o.sharesE8) / 1e8 : null;
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
            seriesId={seriesId}
            roundIdx={series.currentRoundIdx}
            nowMs={nowMs}
          />
        </div>

        <div>
          <TradePanelV3 series={series} initialSide={initialSide} />
        </div>
      </div>
    </div>
  );
}
