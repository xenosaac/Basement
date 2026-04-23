"use client";

import { useQuery } from "@tanstack/react-query";
import { aptos, moduleAddress } from "@/lib/aptos";

export function activeCaseQueryKey(groupId: string) {
  return ["active-case", groupId] as const;
}

/**
 * Read the currently-active case id for a recurring market group
 * (e.g. "btc-3m", "eth-3m") via
 * `${moduleAddress()}::market_factory::get_active_market_in_group`.
 *
 * IMPORTANT: the Move view expects the group id as `vector<u8>` — we pass
 * `Array.from(new TextEncoder().encode(groupId))`, NOT a 0x-hex string. A
 * recent bugfix regressed on the hex path; keep the byte-array encoding.
 *
 * Returns `null` when no active case exists for the group.
 */
export function useActiveCase(groupId: string | null) {
  return useQuery({
    queryKey: activeCaseQueryKey(groupId ?? ""),
    enabled: Boolean(groupId),
    // 3-min cadence + cron is 2-min, so active case can rotate any second.
    // Keep stale window short so a transient RPC failure doesn't stick a
    // null/None in cache for the full round.
    staleTime: 5_000,
    // Self-heal: if the view hits a 429 / transient error, refetch soon.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    queryFn: async (): Promise<bigint | null> => {
      if (!groupId) return null;
      const groupBytes = Array.from(new TextEncoder().encode(groupId));
      const res = (await aptos.view({
        payload: {
          function: `${moduleAddress()}::market_factory::get_active_market_in_group`,
          typeArguments: [],
          functionArguments: [groupBytes],
        },
      })) as [{ vec?: unknown[] }];
      const vec = res[0]?.vec;
      if (!Array.isArray(vec) || vec.length === 0) return null;
      return BigInt(vec[0] as string);
    },
  });
}
