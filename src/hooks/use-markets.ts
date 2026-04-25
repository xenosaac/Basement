"use client";

import { useQuery } from "@tanstack/react-query";
import type { MarketsResponse } from "@/types";

export interface UseMarketsParams {
  state?: string;
  sort?: string;
  type?: "MIRRORED" | "RECURRING";
  limit?: number;
  offset?: number;
  initialData?: MarketsResponse;
}

function getMarketsQueryString(params?: UseMarketsParams) {
  const searchParams = new URLSearchParams();
  if (params?.state) searchParams.set("state", params.state);
  if (params?.sort) searchParams.set("sort", params.sort);
  if (params?.type) searchParams.set("type", params.type);
  if (typeof params?.limit === "number") searchParams.set("limit", String(params.limit));
  if (typeof params?.offset === "number") searchParams.set("offset", String(params.offset));
  return searchParams.toString();
}

export function useMarkets(params?: UseMarketsParams) {
  const qs = getMarketsQueryString(params);

  return useQuery<MarketsResponse>({
    queryKey: ["markets", qs],
    queryFn: async () => {
      const res = await fetch(`/api/markets${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch markets");
      return res.json();
    },
    initialData: params?.initialData,
    staleTime: 3_000,
    gcTime: 5 * 60_000,
    refetchInterval: 4_000,
    refetchOnWindowFocus: true,
  });
}
