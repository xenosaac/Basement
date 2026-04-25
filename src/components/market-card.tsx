"use client";

import Link from "next/link";
import { memo } from "react";
import type { MarketWithPrices } from "@/types";
import { formatUSD, formatPercent, timeRemaining } from "@/lib/utils";
import { getCaseHeadline } from "@/lib/case-copy";

function MarketCardComponent({ market }: { market: MarketWithPrices }) {
  const isLive = market.state === "OPEN";
  const isResolved = market.state === "RESOLVED" || market.state === "SETTLED";
  // Headline derives from groupId when possible (v0.5 dynamic-strike + barrier
  // copy); falls back to market.question for legacy/unrecognised rows.
  const headline = getCaseHeadline({
    recurringGroupId: market.recurringGroupId,
    question: market.question,
    strikePrice: market.strikePrice ?? null,
    barrierLowPriceE8: market.barrierLowPriceE8 ?? null,
    barrierHighPriceE8: market.barrierHighPriceE8 ?? null,
  });

  return (
    <Link href={`/markets/${market.id}`}>
      <div className="group glass glass-hover rounded-[22px] border border-white/[0.06] px-5 py-5 sm:px-7 sm:py-6 flex items-center gap-3 sm:gap-6 transition-all cursor-pointer">
        {/* Left: Market image */}
        {market.imageUrl && (
          <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 bg-white/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={market.imageUrl} alt="" className="w-full h-full object-cover" />
          </div>
        )}

        {/* Center: Question + meta */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-white group-hover:text-accent transition-colors truncate">
            {headline}
          </h3>
          <div className="flex items-center gap-4 mt-1.5">
            {isLive && (
              <span className="flex items-center gap-1.5 text-xs text-white/40">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            )}
            {isResolved && (
              <span className="flex items-center gap-1.5 text-xs text-accent">
                Resolved: {market.resolvedOutcome}
              </span>
            )}
            {market.closeTime && isLive && (
              <span className="text-xs text-white/30">
                {timeRemaining(market.closeTime)}
              </span>
            )}
            <span className="text-xs text-white/30">
              {formatUSD(market.totalVolume)} vol
            </span>
          </div>
        </div>

        {/* Right: YES / NO prices — minimal copy per design system
            (no sub-labels like "Break out / Stay inside"). */}
        <div className="flex gap-1.5 sm:gap-2 shrink-0">
          <div className="flex items-center justify-center gap-1.5 px-3 py-2 sm:px-4 sm:py-2.5 rounded-[12px] bg-yes-dim border border-yes-border min-w-[68px] sm:min-w-[80px]">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-yes/70">
              Yes
            </span>
            <span className="text-sm font-semibold text-yes tabular-nums">
              {formatPercent(market.yesPrice)}
            </span>
          </div>
          <div className="flex items-center justify-center gap-1.5 px-3 py-2 sm:px-4 sm:py-2.5 rounded-[12px] bg-no-dim border border-no-border min-w-[68px] sm:min-w-[80px]">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-no/70">
              No
            </span>
            <span className="text-sm font-semibold text-no tabular-nums">
              {formatPercent(market.noPrice)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export const MarketCard = memo(MarketCardComponent);
