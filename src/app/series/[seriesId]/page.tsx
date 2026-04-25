"use client";

/**
 * Live entry shim. Old `/series/[seriesId]` URL still works (Markets page
 * cards link here) but immediately redirects to the canonical round detail
 * page at `/series/[seriesId]/round/[currentRoundIdx]`. There is exactly
 * one detail UI now — see round/[roundIdx]/page.tsx.
 */

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { useSeriesV3 } from "@/hooks/use-series-v3";

export default function SeriesDetailRedirect() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const router = useRouter();
  const { data, isLoading } = useSeriesV3();
  const series = data?.series.find((s) => s.seriesId === seriesId);

  useEffect(() => {
    if (!series) return;
    router.replace(
      `/series/${series.seriesId}/round/${series.currentRoundIdx}`,
    );
  }, [series, router]);

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 animate-pulse space-y-4">
        <div className="h-6 bg-white/5 rounded w-1/3" />
        <div className="h-32 bg-white/5 rounded-lg" />
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
  // Brief flash before redirect (router.replace runs in effect).
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 text-center text-white/40 text-sm">
      Loading round {series.currentRoundIdx}…
    </div>
  );
}
