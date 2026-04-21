import { MarketGrid } from "@/components/market-grid";
import { FaucetBanner } from "@/components/faucet-banner";
import { getMarketsList, scheduleActiveRecurringMarketsEnsure } from "@/lib/markets-query";
import type { MarketsResponse } from "@/types";

export const dynamic = "force-dynamic";

export default async function MarketsPage() {
  let initialMarkets: MarketsResponse | undefined;
  try {
    scheduleActiveRecurringMarketsEnsure();
    initialMarkets = await getMarketsList();
  } catch (error) {
    console.error("Initial markets preload error:", error);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Markets</h1>
        <p className="text-sm text-white/40">
          Crypto price predictions on Aptos Testnet. Trade with VirtualUSD.
        </p>
      </div>
      <FaucetBanner />
      <MarketGrid initialData={initialMarkets} />
    </div>
  );
}
