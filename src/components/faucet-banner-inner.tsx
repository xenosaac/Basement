"use client";

import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useUser } from "@/hooks/use-user";
import { useBalanceV3 } from "@/hooks/use-balance-v3";
import { useFaucetV3 } from "@/hooks/use-faucet-v3";
import { BetError, codeToUserMessage } from "@/hooks/use-bet-v3";

export function FaucetBannerInner() {
  const { connected: isConnected } = useWallet();
  const user = useUser();
  const address = user.isConnected && user.address ? user.address : undefined;
  const { data: balance } = useBalanceV3(address);
  const faucet = useFaucetV3();

  // v0 = DB-AMM. Real balance lives in user_balances_v3.available_cents,
  // not on-chain FA. availableCents is a stringified bigint of cents.
  const availableCents = Number(balance?.availableCents ?? 0);
  if (!isConnected || !user.isConnected || !address || availableCents > 0) {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const canClaim =
    balance?.nextFaucetAtSec == null || balance.nextFaucetAtSec <= nowSec;

  return (
    <div className="glass rounded-lg p-5 mb-6 flex items-center justify-between border border-accent/20">
      <div>
        <p className="text-sm font-medium text-white">You have 0 VirtualUSD</p>
        <p className="text-xs text-white/40 mt-0.5">
          Claim 50 free VirtualUSD to start trading.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {faucet.error instanceof BetError && (
          <span className="text-xs text-no">
            {codeToUserMessage(faucet.error.code)}
          </span>
        )}
        {canClaim ? (
          <button
            onClick={() => faucet.mutate()}
            disabled={faucet.isPending}
            className="px-4 py-2 bg-accent text-black text-sm font-semibold rounded-pill hover:shadow-glow-sm transition-all disabled:opacity-50"
          >
            {faucet.isPending ? "Claiming..." : "Claim Now"}
          </button>
        ) : (
          <span className="text-xs text-white/40 font-mono tabular-nums">
            Next claim in{" "}
            {Math.ceil(((balance?.nextFaucetAtSec ?? 0) - nowSec) / 3600)}h
          </span>
        )}
      </div>
    </div>
  );
}
