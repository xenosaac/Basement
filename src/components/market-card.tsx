"use client";

import Link from "next/link";
import { memo } from "react";
import type { MarketWithPrices } from "@/types";
import { formatUSD, formatPercent, timeRemaining } from "@/lib/utils";

function MarketCardComponent({ market }: { market: MarketWithPrices }) {
  const isLive = market.state === "OPEN";
  const isResolved = market.state === "RESOLVED" || market.state === "SETTLED";

  return (
    <Link href={`/markets/${market.id}`}>
      <div className="group glass glass-hover rounded-lg px-4 py-4 sm:px-6 sm:py-5 flex items-center gap-3 sm:gap-6 transition-all cursor-pointer">
        {/* Left: Market image */}
        {market.imageUrl && (
          <div className="w-10 h-10 rounded-md overflow-hidden shrink-0 bg-white/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={market.imageUrl} alt="" className="w-full h-full object-cover" />
          </div>
        )}

        {/* Center: Question + meta */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-white group-hover:text-accent transition-colors truncate">
            {market.question}
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

        {/* Right: YES / NO prices */}
        <div className="flex gap-1.5 sm:gap-2 shrink-0">
          <div className="flex flex-col items-center px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-md bg-yes-dim border border-yes-border min-w-[52px] sm:min-w-[64px]">
            <span className="text-[10px] text-white/40 uppercase">Yes</span>
            <span className="text-sm font-semibold text-yes">{formatPercent(market.yesPrice)}</span>
          </div>
          <div className="flex flex-col items-center px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-md bg-no-dim border border-no-border min-w-[52px] sm:min-w-[64px]">
            <span className="text-[10px] text-white/40 uppercase">No</span>
            <span className="text-sm font-semibold text-no">{formatPercent(market.noPrice)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export const MarketCard = memo(MarketCardComponent);
