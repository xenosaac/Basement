"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import {
  readCaseState,
  readUserNoFa,
  readUserVirtualUsdBalance,
  readUserYesFa,
  type CaseStateCode,
  type OutcomeCode,
} from "@/lib/aptos";
import {
  MARKET_GROUPS,
  groupById,
  pythFeedForGroup,
  renderQuestion,
} from "@/lib/market-groups";

export interface OnChainPosition {
  caseId: string;
  groupId?: string;
  question?: string;
  closeTime: number;
  state: CaseStateCode;
  resolvedOutcome: OutcomeCode;
  yesShares: bigint;
  noShares: bigint;
  yesReserve: bigint;
  noReserve: bigint;
  strikePrice: bigint;
}

export interface OnChainPortfolio {
  address: string;
  balance: bigint;
  positions: OnChainPosition[];
}

export function portfolioOnChainQueryKey(address?: string) {
  return ["portfolio-onchain", address ?? null] as const;
}

/** Normalize feed id to lowercase 0x-prefixed hex for comparison. */
function normalizeFeedId(raw: string): string {
  const hex = raw.toLowerCase();
  return hex.startsWith("0x") ? hex : `0x${hex}`;
}

/**
 * Resolve a case's spec. Prefers the on-chain `recurring_group_id` field
 * (parsed by {@link readCaseState}) — this is the only correct path for
 * up/down pairs (xau-daily-up + xau-daily-down share one Pyth feed, so
 * feed-id matching would collapse them to the same spec). Falls back to
 * feed-id matching for legacy cases spawned before MarketConfig stored
 * the group id.
 */
function resolveSpecForCase(
  recurringGroupId: string | null,
  feedId: string,
): ReturnType<typeof groupById> {
  if (recurringGroupId) {
    const bySpec = groupById(recurringGroupId);
    if (bySpec) return bySpec;
  }
  const target = normalizeFeedId(feedId);
  for (const spec of Object.values(MARKET_GROUPS)) {
    if (spec.resolutionKind !== "pyth") continue;
    let groupFeed: string;
    try {
      groupFeed = normalizeFeedId(pythFeedForGroup(spec));
    } catch {
      continue;
    }
    if (groupFeed === target) return spec;
  }
  return undefined;
}

export function usePortfolioOnChain(): UseQueryResult<OnChainPortfolio> {
  const { account } = useWallet();
  const address = account?.address?.toString();

  return useQuery<OnChainPortfolio>({
    queryKey: portfolioOnChainQueryKey(address),
    enabled: !!address,
    staleTime: 10_000,
    queryFn: async () => {
      if (!address) throw new Error("no wallet address");

      const casesRes = await fetch("/api/portfolio/cases", { cache: "no-store" });
      if (!casesRes.ok) {
        throw new Error(`portfolio/cases failed: ${casesRes.status}`);
      }
      const { caseIds } = (await casesRes.json()) as { caseIds: string[] };

      const [balance, perCase] = await Promise.all([
        readUserVirtualUsdBalance(address),
        Promise.all(
          caseIds.map(async (cid) => {
            const caseId = BigInt(cid);
            const state = await readCaseState(caseId);
            // Guard: if the vault has no FA metadata (edge shape / drained),
            // show zero shares rather than throwing the whole query.
            const [yesShares, noShares] = await Promise.all([
              state.yesMetadata
                ? readUserYesFa(address, caseId).catch(() => 0n)
                : Promise.resolve(0n),
              state.noMetadata
                ? readUserNoFa(address, caseId).catch(() => 0n)
                : Promise.resolve(0n),
            ]);
            return { cid, state, yesShares, noShares };
          }),
        ),
      ]);

      const positions: OnChainPosition[] = perCase.map(
        ({ cid, state, yesShares, noShares }) => {
          const spec = resolveSpecForCase(
            state.recurringGroupId,
            state.assetPythFeedId,
          );
          const question = spec
            ? renderQuestion(spec, state.strikePrice, Number(state.closeTime))
            : undefined;
          return {
            caseId: cid,
            groupId: spec?.groupId,
            question,
            closeTime: Number(state.closeTime),
            state: state.state,
            resolvedOutcome: state.resolvedOutcome,
            yesShares,
            noShares,
            yesReserve: state.yesReserve,
            noReserve: state.noReserve,
            strikePrice: state.strikePrice,
          };
        },
      );

      // UI-tidying filter: drop fully-zero positions on non-resolved cases.
      // Keep resolved (state 2) or drained (state 3) — those drive the claim
      // flow / history ledger UI.
      const filtered = positions.filter((p) => {
        if (p.state === 2 || p.state === 3) return true;
        return p.yesShares > 0n || p.noShares > 0n;
      });

      return { address, balance, positions: filtered };
    },
  });
}
