"use client";

import { useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Network } from "@aptos-labs/ts-sdk";
import { useFaucet } from "@/hooks/use-faucet";
import { useUser } from "@/hooks/use-user";
import { usePortfolioOnChain } from "@/hooks/use-portfolio-onchain";
import { useAptosAuth } from "./aptos-auth-provider";

const APTOS_TESTNET_CHAIN_ID = 2;

export function FaucetBannerInner() {
  const { connected: isConnected, network, changeNetwork } = useWallet();
  const user = useUser();
  const { isAuthenticated, supportsFeePayer } = useAptosAuth();
  const { claim, isPending, message } = useFaucet();
  const { data: portfolio } = usePortfolioOnChain();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const balance = Number(portfolio?.balance ?? 0n) / 1_000_000;
  if (!isConnected || !isAuthenticated || !user || balance > 0) {
    return null;
  }

  // Wallet-network gate: OKX / Bitget / etc. ignore the dapp's dappConfig
  // and submit against whatever chain their extension is currently set to.
  // Block the Claim if the wallet isn't on Aptos Testnet — submitting to
  // mainnet (where the user likely has 0 APT) surfaces as "Insufficient
  // balance" with no useful context.
  const walletChainId = network?.chainId;
  const wrongNetwork =
    walletChainId !== undefined && walletChainId !== APTOS_TESTNET_CHAIN_ID;

  if (wrongNetwork) {
    const handleSwitch = async () => {
      setSwitching(true);
      setSwitchError(null);
      try {
        await changeNetwork(Network.TESTNET);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const manualHint =
          "Open your wallet → Settings → Networks → pick Aptos Testnet, " +
          "or switch to Petra (handles this automatically).";
        setSwitchError(
          msg.toLowerCase().includes("reject")
            ? `Switch was rejected in your wallet. ${manualHint}`
            : `Switch failed: ${msg}. ${manualHint}`,
        );
      } finally {
        setSwitching(false);
      }
    };

    return (
      <div className="glass rounded-lg p-5 mb-6 flex items-center justify-between border border-no/30">
        <div>
          <p className="text-sm font-medium text-white">Wrong wallet network</p>
          <p className="text-xs text-white/50 mt-0.5">
            Your wallet is on{" "}
            <span className="font-mono">{network?.name ?? `chain ${walletChainId}`}</span>
            . Basement runs on{" "}
            <span className="text-accent font-medium">Aptos Testnet</span>.
          </p>
          {switchError && (
            <p className="text-xs text-no mt-1">{switchError}</p>
          )}
        </div>
        <button
          onClick={handleSwitch}
          disabled={switching}
          className="px-4 py-2 bg-accent text-black text-sm font-semibold rounded-pill hover:shadow-glow-sm transition-all disabled:opacity-50"
        >
          {switching ? "Switching..." : "Switch to Testnet"}
        </button>
      </div>
    );
  }

  return (
    <div className="glass rounded-lg p-5 mb-6 flex items-center justify-between border border-accent/20">
      <div>
        <p className="text-sm font-medium text-white">You have 0 VirtualUSD</p>
        <p className="text-xs text-white/40 mt-0.5">
          {supportsFeePayer
            ? "Claim 50 free VirtualUSD to start trading."
            : "Claim 50 free VirtualUSD — you pay ~0.0001 testnet APT in gas."}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => claim()}
          disabled={isPending}
          className="px-4 py-2 bg-accent text-black text-sm font-semibold rounded-pill hover:shadow-glow-sm transition-all disabled:opacity-50"
        >
          {isPending ? "Claiming..." : "Claim Now"}
        </button>
        {message && (
          <span className={`text-xs ${message.startsWith("+") ? "text-yes" : "text-no"}`}>{message}</span>
        )}
      </div>
    </div>
  );
}
