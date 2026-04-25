"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  formatCentsShare,
  formatUsdFromCents,
  impliedProbability,
  isSeriesResolving,
} from "@/lib/v3-pricing";
import { renderSeriesQuestion } from "@/lib/utils";
import type { SeriesSummary } from "@/lib/types/v3-api";

export interface SeriesCardV2Props {
  series: SeriesSummary;
  nowMs: number;
  variant?: "default" | "hero";
}

const ASSET_TINTS: Record<string, { bg: string; fg: string }> = {
  BTC: { bg: "bg-[#f7931a]/20", fg: "text-[#f7931a]" },
  ETH: { bg: "bg-[#627eea]/20", fg: "text-[#627eea]" },
  SOL: { bg: "bg-[#a78bfa]/20", fg: "text-[#a78bfa]" },
  XAU: { bg: "bg-[#ffd700]/20", fg: "text-[#ffd700]" },
  XAG: { bg: "bg-[#c0c0c0]/20", fg: "text-[#c0c0c0]" },
  US500: { bg: "bg-[#3b82f6]/20", fg: "text-[#3b82f6]" },
  HYPE: { bg: "bg-[#22d3ee]/20", fg: "text-[#22d3ee]" },
};

export function AssetIcon({
  symbol,
  size = 28,
}: {
  symbol: string;
  size?: 20 | 28 | 36;
}) {
  const tint = ASSET_TINTS[symbol] ?? {
    bg: "bg-white/10",
    fg: "text-white/70",
  };
  const fontSize = size === 36 ? "text-sm" : size === 28 ? "text-xs" : "text-[10px]";
  return (
    <div
      className={`shrink-0 rounded-full flex items-center justify-center font-bold ${tint.bg} ${tint.fg} ${fontSize}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {symbol.slice(0, symbol === "US500" ? 3 : 1)}
    </div>
  );
}

function countdownLabel(closeTimeSec: number, nowMs: number): string {
  const diffSec = closeTimeSec - Math.floor(nowMs / 1000);
  if (diffSec <= 0) return "Settling…";
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function ImpliedPriceRow({
  seriesId,
  upCents,
  downCents,
  variant,
  disabled,
}: {
  seriesId: string;
  upCents: number;
  downCents: number;
  variant: "default" | "hero";
  disabled?: boolean;
}) {
  const isHero = variant === "hero";
  const cellBase = `rounded-[12px] px-3 py-2 flex items-baseline justify-between transition-colors`;
  const yesCell = `bg-yes-dim/40 border border-yes-border ${disabled ? "opacity-60 pointer-events-none" : "hover:bg-yes-dim/70 hover:border-yes/70"}`;
  const noCell = `bg-no-dim/40 border border-no-border ${disabled ? "opacity-60 pointer-events-none" : "hover:bg-no-dim/70 hover:border-no/70"}`;
  return (
    <div
      className={`grid grid-cols-2 gap-2 ${isHero ? "mt-4" : "mt-3"}`}
      aria-label="Market implied probability"
    >
      <Link
        href={`/series/${seriesId}?side=UP`}
        aria-label={`Trade Yes at ${formatCentsShare(upCents)}`}
        className={`${cellBase} ${yesCell}`}
      >
        <span className={`uppercase tracking-[2px] text-yes ${isHero ? "text-[11px]" : "text-[10px]"}`}>
          Yes
        </span>
        <span
          className={`font-mono tabular-nums text-yes ${isHero ? "text-base" : "text-sm"}`}
        >
          {formatCentsShare(upCents)}
        </span>
      </Link>
      <Link
        href={`/series/${seriesId}?side=DOWN`}
        aria-label={`Trade No at ${formatCentsShare(downCents)}`}
        className={`${cellBase} ${noCell}`}
      >
        <span className={`uppercase tracking-[2px] text-no ${isHero ? "text-[11px]" : "text-[10px]"}`}>
          No
        </span>
        <span
          className={`font-mono tabular-nums text-no ${isHero ? "text-base" : "text-sm"}`}
        >
          {formatCentsShare(downCents)}
        </span>
      </Link>
    </div>
  );
}

export function SeriesCardV2({
  series: s,
  nowMs,
  variant = "default",
}: SeriesCardV2Props) {
  const isHero = variant === "hero";
  const question = renderSeriesQuestion({ pair: s.pair, cadenceSec: s.cadenceSec });
  const countdown = countdownLabel(s.currentCloseTimeSec, nowMs);
  const closing =
    s.currentCloseTimeSec - Math.floor(nowMs / 1000) <= 0;

  const probability = useMemo(
    () =>
      impliedProbability(
        BigInt(s.currentUpPoolCents),
        BigInt(s.currentDownPoolCents),
      ),
    [s.currentUpPoolCents, s.currentDownPoolCents],
  );

  const resolving = useMemo(
    () =>
      isSeriesResolving(
        {
          currentCloseTimeSec: s.currentCloseTimeSec,
          currentResolvedOutcome: s.currentResolvedOutcome,
        },
        nowMs,
      ),
    [s.currentCloseTimeSec, s.currentResolvedOutcome, nowMs],
  );

  const winnerSide = resolving.winnerSide;
  const ringClass = winnerSide === "UP"
    ? "shadow-[inset_0_0_0_1px_rgba(34,197,94,0.4)]"
    : winnerSide === "DOWN"
      ? "shadow-[inset_0_0_0_1px_rgba(239,68,68,0.4)]"
      : "";

  const cardOuter = `group relative rounded-[${isHero ? "24px" : "22px"}] bg-[rgba(17,17,19,0.9)] backdrop-blur-2xl border border-white/[0.08] hover:border-white/[0.18] transition-[border-color,transform] duration-200 ${
    isHero
      ? "p-6 hover:-translate-y-[1px] shadow-[0_0_40px_rgba(255,221,0,0.04)]"
      : "p-4 md:p-5"
  } ${ringClass}`;

  return (
    <article className={cardOuter} data-state={resolving.resolving ? "resolving" : "open"}>
      <Link
        href={`/series/${s.seriesId}`}
        className="block"
        aria-label={`Open ${s.pair} market`}
      >
        <header className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <AssetIcon symbol={s.assetSymbol} size={isHero ? 36 : 28} />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[2px] text-white/40 truncate">
                {s.pair}
              </div>
              <div className="text-[10px] uppercase tracking-[2px] text-white/30">
                {s.cadenceSec === 180 ? "3-min" : "1-hour"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-black/60 border border-glass-border">
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                resolving.resolving
                  ? "bg-white/30"
                  : closing
                    ? "bg-white/30"
                    : "bg-accent animate-pulse"
              }`}
            />
            <span className="text-xs font-mono text-accent tabular-nums">
              {countdown}
            </span>
          </div>
        </header>

        <h3
          className={`font-semibold text-white leading-snug mb-2 ${
            isHero ? "text-lg" : "text-base"
          }`}
        >
          {question}
        </h3>

        {!s.marketHours.open && (
          <div className="mb-2 text-[11px] text-amber-300/80">
            Market closed
            {s.marketHours.reason ? ` (${s.marketHours.reason})` : ""}
          </div>
        )}
      </Link>

      <ImpliedPriceRow
        seriesId={s.seriesId}
        upCents={probability.upCents}
        downCents={probability.downCents}
        variant={variant}
        disabled={resolving.resolving || !s.marketHours.open}
      />

      <Link
        href={`/series/${s.seriesId}`}
        tabIndex={-1}
        aria-hidden="true"
        className="block mt-3 text-[10px] uppercase tracking-[2px] text-white/30 hover:text-white/50 transition"
      >
        Round {s.currentRoundIdx} · Live {formatUsdFromCents(s.currentPriceCents)}
      </Link>
    </article>
  );
}
