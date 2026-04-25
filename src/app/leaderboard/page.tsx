"use client";

import { useLeaderboard } from "@/hooks/use-leaderboard";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { formatUSD, shortenAddress } from "@/lib/utils";

export default function LeaderboardPage() {
  const { data: entries, isLoading } = useLeaderboard(50);
  const { account } = useWallet();
  const address = account?.address?.toString() ?? null;
  const myAddress = address?.toLowerCase();

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-3 animate-pulse">
        <div className="h-8 bg-white/5 rounded w-48 mb-6" />
        {[...Array(10)].map((_, i) => (
          <div key={i} className="glass rounded-lg h-14" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Leaderboard</h1>
        <p className="text-sm text-white/40">
          Top traders ranked by realized PNL (closed trades + claims). Open
          positions not yet valued.
        </p>
      </div>

      {!entries || entries.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <p>No traders yet. Be the first to trade.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const isMe = myAddress === entry.address.toLowerCase();
            const isTop3 = entry.rank <= 3;
            const isPositive = entry.profit >= 0;

            return (
              <div
                key={entry.address}
                className={`glass rounded-lg px-5 py-3.5 flex items-center gap-4 ${
                  isMe ? "border-accent/30 bg-accent-glow" : ""
                }`}
              >
                {/* Rank */}
                <div className="w-10 text-center shrink-0">
                  {isTop3 ? (
                    <span
                      className={`text-lg font-bold ${
                        entry.rank === 1
                          ? "text-[#FFDD00]"
                          : entry.rank === 2
                            ? "text-white/70"
                            : "text-[#CD7F32]"
                      }`}
                    >
                      {entry.rank === 1
                        ? "1st"
                        : entry.rank === 2
                          ? "2nd"
                          : "3rd"}
                    </span>
                  ) : (
                    <span className="text-sm text-white/30">#{entry.rank}</span>
                  )}
                </div>

                {/* Address */}
                <div className="flex-1 min-w-0">
                  <span
                    className={`text-sm font-medium ${isMe ? "text-accent" : "text-white"}`}
                  >
                    {isMe ? "You" : shortenAddress(entry.address)}
                  </span>
                  {isMe && (
                    <span className="text-xs text-white/30 ml-2">
                      {shortenAddress(entry.address)}
                    </span>
                  )}
                </div>

                {/* Trades */}
                <div className="hidden sm:block text-xs text-white/30 shrink-0">
                  {entry.tradeCount} trades
                </div>

                {/* Realized PNL */}
                <div className="shrink-0 text-right">
                  <span
                    className={`text-sm font-semibold ${
                      isPositive ? "text-yes" : "text-no"
                    }`}
                  >
                    {isPositive ? "+" : ""}
                    {formatUSD(entry.profit)}
                  </span>
                  <span className="text-xs text-white/30 ml-1">PNL</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
