"use client";

import Link from "next/link";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useAptosAuth } from "./aptos-auth-provider";
import { useConnectModal } from "./connect-modal-provider";
import { useBalanceV3 } from "@/hooks/use-balance-v3";
import { formatUSD } from "@/lib/utils";

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function NavbarDesktopPortfolioLink() {
  const { connected } = useWallet();
  if (!connected) return null;

  return (
    <Link
      href="/portfolio"
      className="text-sm text-white/50 hover:text-white transition-colors"
    >
      Portfolio
    </Link>
  );
}

export function NavbarWalletControls() {
  const { connected, account, wallet, disconnect } = useWallet();
  const { isAuthenticated, isAuthenticating, authError, signIn } =
    useAptosAuth();
  const { open: openConnectModal } = useConnectModal();
  const addressStr = account?.address.toString();
  const { data: balanceData } = useBalanceV3(
    isAuthenticated && addressStr ? addressStr : undefined,
  );

  const balance = Number(balanceData?.availableCents ?? 0) / 100;

  return (
    <>
      {connected && isAuthenticated && addressStr && (
        <div className="hidden sm:block px-3 py-1 rounded-pill bg-white/[0.05] border border-glass-border">
          <span className="text-xs text-white/40 mr-1.5">Balance</span>
          <span className="text-sm font-medium text-accent">
            {formatUSD(balance)}
          </span>
        </div>
      )}

      {connected && !isAuthenticated && (
        <button
          onClick={signIn}
          disabled={isAuthenticating}
          title={authError?.message}
          className="hidden sm:block px-3 py-1 rounded-pill bg-white/[0.05] border border-glass-border text-xs text-white/70 hover:text-white transition-colors disabled:opacity-50"
        >
          {isAuthenticating
            ? "Signing…"
            : authError
              ? "Retry Sign-In"
              : "Sign In"}
        </button>
      )}

      {connected && addressStr ? (
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline px-3 py-1 rounded-pill bg-white/[0.05] border border-glass-border text-xs text-white/80">
            {wallet?.name ? `${wallet.name}: ` : ""}
            {truncateAddress(addressStr)}
          </span>
          <button
            onClick={() => disconnect()}
            className="px-3 py-1.5 rounded-pill bg-white/[0.05] border border-glass-border text-xs text-white/70 hover:text-white transition-colors"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          onClick={openConnectModal}
          className="px-4 py-1.5 rounded-pill bg-white text-black text-sm font-medium hover:bg-white/90 transition-colors"
        >
          Connect Wallet
        </button>
      )}
    </>
  );
}

export function NavbarMobileWalletItems({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  const { connected, account } = useWallet();
  const { isAuthenticated } = useAptosAuth();
  const addressStr = account?.address.toString();
  const { data: balanceData } = useBalanceV3(
    isAuthenticated && addressStr ? addressStr : undefined,
  );
  const balance = Number(balanceData?.availableCents ?? 0) / 100;

  return (
    <>
      {connected && (
        <Link
          href="/portfolio"
          onClick={onNavigate}
          className="text-sm text-white/70 hover:text-white py-2 border-b border-glass-border"
        >
          Portfolio
        </Link>
      )}
      {connected && isAuthenticated && (
        <div className="text-sm py-2">
          <span className="text-white/40">Balance </span>
          <span className="text-white font-medium">${formatUSD(balance)}</span>
        </div>
      )}
    </>
  );
}
