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

/**
 * v3: `<WalletProviders>` wraps unconditionally for all non-landing pages.
 * Prior allow-list logic missed `/series/*` → `useAptosAuth` crashed.
 * Also: only one `AptosWalletAdapterProvider` in the tree; navbar no longer
 * creates its own (fixes state split between navbar + page).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const pathname = usePathname();
  const isLanding = pathname === "/";

  const page = (
    <>
      {!isLanding && <Navbar withWalletProvider={false} />}
      <main className="pt-20">{children}</main>
    </>
  );

  return (
    <QueryClientProvider client={queryClient}>
      {isLanding ? page : <WalletProviders>{page}</WalletProviders>}
    </QueryClientProvider>
  );
}
