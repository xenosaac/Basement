import { SeriesGrid } from "@/components/series-grid";
import { FaucetBanner } from "@/components/faucet-banner";

export const dynamic = "force-dynamic";

export default function MarketsPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Markets</h1>
        <p className="text-sm text-white/40">
          Parimutuel price predictions · VirtualUSD · sign in with wallet
        </p>
      </div>
      <FaucetBanner />
      <SeriesGrid />
    </div>
  );
}
