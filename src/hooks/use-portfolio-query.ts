import type { UserPortfolio } from "@/types";

export const portfolioQueryKey = (address: string | undefined, isAuthenticated: boolean) =>
  ["portfolio", address, isAuthenticated] as const;

export const portfolioAddressQueryKey = (address: string | undefined) =>
  ["portfolio", address] as const;

export async function fetchPortfolio(address: string | undefined, isAuthenticated: boolean) {
  const res = await fetch(
    isAuthenticated ? "/api/portfolio" : `/api/portfolio?address=${address}`,
    { cache: "no-store" }
  );

  if (res.status === 401 && address) {
    const fallback = await fetch(`/api/portfolio?address=${address}`, {
      cache: "no-store",
    });
    if (!fallback.ok) throw new Error("Failed to fetch portfolio");
    return fallback.json() as Promise<UserPortfolio>;
  }

  if (!res.ok) throw new Error("Failed to fetch portfolio");
  return res.json() as Promise<UserPortfolio>;
}
