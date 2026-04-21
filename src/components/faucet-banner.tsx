"use client";

import dynamic from "next/dynamic";

const FaucetBannerInner = dynamic(
  () => import("./faucet-banner-inner").then((mod) => mod.FaucetBannerInner),
  { ssr: false }
);

export function FaucetBanner() {
  return <FaucetBannerInner />;
}
