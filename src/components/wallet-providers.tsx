"use client";

import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { Network } from "@aptos-labs/ts-sdk";
import { AptosAuthProvider } from "./aptos-auth-provider";
import { ConnectModalProvider } from "./connect-modal-provider";
import { ToastQueueProvider } from "./toast-queue-provider";

const OPT_IN_WALLETS = [
  "OKX Wallet",
  "Bitget Wallet",
  "Petra",
  "Backpack",
  "Nightly",
] as const;

function resolveNetwork(): Network {
  const raw = (process.env.NEXT_PUBLIC_APTOS_NETWORK ?? "testnet").toLowerCase();
  switch (raw) {
    case "mainnet":
      return Network.MAINNET;
    case "devnet":
      return Network.DEVNET;
    case "local":
      return Network.LOCAL;
    case "testnet":
    default:
      return Network.TESTNET;
  }
}

function resolveApiKeys(): Partial<Record<Network, string>> | undefined {
  const key = process.env.NEXT_PUBLIC_APTOS_API_KEY;
  if (!key) return undefined;
  const network = resolveNetwork();
  return { [network]: key } as Partial<Record<Network, string>>;
}

export function WalletProviders({ children }: { children: React.ReactNode }) {
  return (
    <AptosWalletAdapterProvider
      autoConnect
      optInWallets={OPT_IN_WALLETS}
      dappConfig={{
        network: resolveNetwork(),
        aptosApiKeys: resolveApiKeys(),
      }}
      onError={(err) => {
        console.error("Aptos wallet error:", err);
      }}
    >
      <AptosAuthProvider>
        <ConnectModalProvider>
          <ToastQueueProvider>{children}</ToastQueueProvider>
        </ConnectModalProvider>
      </AptosAuthProvider>
    </AptosWalletAdapterProvider>
  );
}
