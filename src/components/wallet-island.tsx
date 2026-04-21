"use client";

import dynamic from "next/dynamic";

const WalletProviders = dynamic(
  () => import("./wallet-providers").then((mod) => mod.WalletProviders),
  { ssr: false },
);

export function WalletIsland({ children }: { children: React.ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}
