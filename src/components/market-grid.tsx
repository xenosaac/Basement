"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useMarkets } from "@/hooks/use-markets";
import { MarketCard } from "./market-card";
import {
  isActiveRecurringGroupId,
  categoryForRecurringGroupId,
  sortNameForRecurringGroupId,
  type Category,
} from "@/lib/market-groups";
import type { MarketsResponse, MarketWithPrices } from "@/types";

type TabValue = Category | "all";

const CATEGORIES: { label: string; value: TabValue }[] = [
  { label: "All", value: "all" },
  { label: "Crypto", value: "crypto" },
  { label: "Stocks", value: "stocks" },
  { label: "Commodity", value: "commodity" },
  { label: "Others", value: "others" },
];

// Tabs that currently have no live markets. Shown with a minimal "Coming Soon"
// placeholder instead of the generic "No markets" empty state.
const COMING_SOON_TABS: ReadonlySet<TabValue> = new Set<TabValue>([
  "stocks",
  "others",
]);

function compareBySortName(a: MarketWithPrices, b: MarketWithPrices): number {
  const sa = sortNameForRecurringGroupId(a.recurringGroupId) ?? a.question;
  const sb = sortNameForRecurringGroupId(b.recurringGroupId) ?? b.question;
  return sa.localeCompare(sb);
}

function getCountdownLabel(closeTime: string, now: number) {
  const diff = new Date(closeTime).getTime() - now;
  if (diff <= 0) return "Closing...";
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function Countdown({ closeTime, now }: { closeTime: string; now: number }) {
  return (
    <span className="text-xs font-mono text-accent tabular-nums">
      {getCountdownLabel(closeTime, now)}
    </span>
  );
}

export function MarketGrid({ initialData }: { initialData?: MarketsResponse }) {
  const { data, isLoading, error } = useMarkets({ initialData });
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [now, setNow] = useState(() => Date.now());

  const groupedMarkets = useMemo(() => {
    const allMarkets = data?.markets ?? [];
    const byCategory: Record<TabValue, MarketWithPrices[]> = {
      all: [],
      crypto: [],
      stocks: [],
      commodity: [],
      others: [],
    };
    const recurringMarkets: MarketWithPrices[] = [];

    for (const market of allMarkets) {
      // Quick Play strip surfaces active, open recurring markets at the top
      // of the page. Duplication with the category tabs is intentional —
      // Quick Play is a featured strip; tabs are the catalog.
      if (
        market.marketType === "RECURRING" &&
        market.state === "OPEN" &&
        isActiveRecurringGroupId(market.recurringGroupId)
      ) {
        recurringMarkets.push(market);
      }

      byCategory.all.push(market);
      const cat = categoryForRecurringGroupId(market.recurringGroupId);
      byCategory[cat].push(market);
    }

    for (const key of Object.keys(byCategory) as TabValue[]) {
      byCategory[key].sort(compareBySortName);
    }
    recurringMarkets.sort(compareBySortName);

    return { recurringMarkets, regularByCategory: byCategory };
  }, [data?.markets]);

  const { recurringMarkets, regularByCategory } = groupedMarkets;
  const filtered = regularByCategory[activeTab] ?? regularByCategory.all;
  const hasCountdowns = recurringMarkets.some((market) => market.closeTime);

  useEffect(() => {
    if (!hasCountdowns) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasCountdowns]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="glass rounded-lg px-6 py-5 h-[76px] animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16 text-white/40">
        Failed to load markets. Is the database connected?
      </div>
    );
  }

  return (
    <div>
      {/* Quick Play — recurring markets */}
      {recurringMarkets.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-sm font-semibold text-white uppercase tracking-[2px]">Quick Play</h2>
            <span className="text-[10px] text-white/30 uppercase tracking-[2px]">3-min rounds</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {recurringMarkets.map((market) => (
              <div key={market.id} className="relative">
                <MarketCard market={market} />
                {market.closeTime && (
                  <div className="absolute top-3 right-3 px-2.5 py-1 rounded-pill bg-black/60 backdrop-blur-xs border border-glass-border flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    <Countdown closeTime={market.closeTime} now={now} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-1 mb-6 border-b border-glass-border pb-px overflow-x-auto">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setActiveTab(cat.value)}
            className={`relative px-4 py-2.5 text-sm whitespace-nowrap transition-colors ${
              activeTab === cat.value
                ? "text-accent font-medium"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            {cat.label}
            {activeTab === cat.value && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Market list */}
      {filtered.length === 0 ? (
        COMING_SOON_TABS.has(activeTab) ? (
          <div className="text-center py-16">
            <p className="text-xs uppercase tracking-[3px] text-white/35">
              Coming Soon
            </p>
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-white/40 mb-1">No markets in this category.</p>
            <p className="text-xs text-white/25">Check back soon for new markets.</p>
          </div>
        )
      ) : (
        <div className="space-y-3">
          {filtered.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}
    </div>
  );
}

export const MemoizedMarketGrid = memo(MarketGrid);
