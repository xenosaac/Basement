"use client";

import { useQuery } from "@tanstack/react-query";
import type { SeriesListResponse } from "@/lib/types/v3-api";

export function useSeriesV3() {
  return useQuery<SeriesListResponse>({
    queryKey: ["series-v3"],
    queryFn: async () => {
      const res = await fetch("/api/series", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch series");
      return res.json();
    },
    staleTime: 3_000,
    refetchInterval: 4_000,
    refetchOnWindowFocus: true,
  });
}
