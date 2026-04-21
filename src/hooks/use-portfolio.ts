"use client";

import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import type { UserPortfolio } from "@/types";
import { useAptosAuth } from "@/components/aptos-auth-provider";
import { fetchPortfolio, portfolioQueryKey } from "./use-portfolio-query";

export function usePortfolio() {
  const { account } = useWallet();
  const address = account?.address?.toString() ?? undefined;
  const { isAuthenticated } = useAptosAuth();

  return useQuery<UserPortfolio>({
    queryKey: portfolioQueryKey(address, isAuthenticated),
    queryFn: () => fetchPortfolio(address, isAuthenticated),
    enabled: !!address,
    staleTime: 10_000,
  });
}
