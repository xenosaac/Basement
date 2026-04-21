"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Navbar } from "./navbar";

const WalletProviders = dynamic(
  () => import("./wallet-providers").then((mod) => mod.WalletProviders),
  { ssr: false },
);

function pageNeedsWalletProvider(pathname: string | null) {
  if (!pathname || pathname === "/") return false;
  return (
    pathname === "/markets" ||
    pathname.startsWith("/portfolio") ||
    pathname.startsWith("/leaderboard") ||
    /^\/markets\/[^/]+/.test(pathname)
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const pathname = usePathname();
  const isLanding = pathname === "/";
  const needsWalletProvider = pageNeedsWalletProvider(pathname);

  const page = (
    <>
      {!isLanding && <Navbar withWalletProvider={!needsWalletProvider} />}
      <main className="pt-20">{children}</main>
    </>
  );

  return (
    <QueryClientProvider client={queryClient}>
      {needsWalletProvider ? <WalletProviders>{page}</WalletProviders> : page}
    </QueryClientProvider>
  );
}
