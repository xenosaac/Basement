"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useSeriesV3 } from "@/hooks/use-series-v3";
import { SeriesCardV2 } from "@/components/series-card-v2";
import type { SeriesCategory, SeriesSummary } from "@/lib/types/v3-api";

type TabValue = "all" | "crypto" | "commodity" | "stocks" | "others";

const CATEGORIES: { label: string; value: TabValue }[] = [
  { label: "All", value: "all" },
  { label: "Crypto", value: "crypto" },
  { label: "Commodity", value: "commodity" },
  { label: "Stocks", value: "stocks" },
  { label: "Others", value: "others" },
];

const QUICK_PLAY_IDS = new Set(["btc-usdc-3m", "eth-usdc-3m"]);

const CRYPTO_CATEGORIES: SeriesCategory[] = ["quick_play", "crypto_ext"];
const COMMODITY_CATEGORIES: SeriesCategory[] = ["commodity"];
const STOCKS_CATEGORIES: SeriesCategory[] = ["stocks"];
const KNOWN_CATEGORIES: SeriesCategory[] = [
  ...CRYPTO_CATEGORIES,
  ...COMMODITY_CATEGORIES,
  ...STOCKS_CATEGORIES,
];

export function SeriesGrid() {
  const { data, isLoading, error } = useSeriesV3();
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const grouped = useMemo(() => {
    const all = data?.series ?? [];
    const quickPlay = all.filter((s) => QUICK_PLAY_IDS.has(s.seriesId));
    const byTab: Record<TabValue, SeriesSummary[]> = {
      all,
      crypto: all.filter((s) => CRYPTO_CATEGORIES.includes(s.category)),
      commodity: all.filter((s) => COMMODITY_CATEGORIES.includes(s.category)),
      stocks: all.filter((s) => STOCKS_CATEGORIES.includes(s.category)),
      others: all.filter((s) => !KNOWN_CATEGORIES.includes(s.category)),
    };
    return { all, quickPlay, byTab };
  }, [data?.series]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="rounded-[22px] bg-black/30 border border-white/[0.06] h-[360px] animate-pulse"
          />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-16 text-white/40">
        Failed to load markets.
      </div>
    );
  }

  const filtered = grouped.byTab[activeTab];

  return (
    <div>
      {grouped.quickPlay.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-sm font-semibold text-white uppercase tracking-[2px]">
              Quick Play
            </h2>
            <span className="text-[10px] text-white/30 uppercase tracking-[2px]">
              3-min rounds
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {grouped.quickPlay.map((s) => (
              <SeriesCardV2
                key={s.seriesId}
                series={s}
                nowMs={nowMs}
                variant="hero"
              />
            ))}
          </div>
        </div>
      )}

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

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <p className="text-xs uppercase tracking-[3px]">
            No markets in this category
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((s) => (
            <SeriesCardV2 key={s.seriesId} series={s} nowMs={nowMs} />
          ))}
        </div>
      )}
    </div>
  );
}

export const MemoizedSeriesGrid = memo(SeriesGrid);
