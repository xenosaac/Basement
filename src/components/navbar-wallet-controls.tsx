"use client";

import Link from "next/link";
import { useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useAptosAuth } from "./aptos-auth-provider";

const SUPPORTED_BRANDS = ["Petra", "OKX Wallet"] as const;
type SupportedBrand = (typeof SUPPORTED_BRANDS)[number];

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

function BrandButton({
  brand,
  onConnect,
  pending,
}: {
  brand: SupportedBrand;
  onConnect: (brand: SupportedBrand) => void;
  pending: SupportedBrand | null;
}) {
  const { wallets, notDetectedWallets } = useWallet();
  const detected = wallets.find((w) => w.name === brand);
  const missing = notDetectedWallets.find((w) => w.name === brand);

  if (!detected && missing) {
    return (
      <a
        href={missing.url}
        target="_blank"
        rel="noopener noreferrer"
        className="px-3 py-1.5 rounded-pill bg-white/[0.05] border border-glass-border text-xs text-white/70 hover:text-white transition-colors"
      >
        Install {brand}
      </a>
    );
  }

  if (!detected) {
    // Neither detected nor in not-detected list (wallet standard hasn't
    // surfaced it yet). Render a disabled placeholder.
    return (
      <button
        disabled
        className="px-3 py-1.5 rounded-pill bg-white/[0.03] border border-glass-border text-xs text-white/40 cursor-not-allowed"
      >
        {brand} (unavailable)
      </button>
    );
  }

  const isPending = pending === brand;
  return (
    <button
      onClick={() => onConnect(brand)}
      disabled={isPending}
      className="px-3 py-1.5 rounded-pill bg-white/[0.05] border border-glass-border text-xs text-white/80 hover:text-white transition-colors disabled:opacity-50"
    >
      {isPending ? `Connecting…` : `Connect ${brand}`}
    </button>
  );
}

export function NavbarWalletControls() {
  const { connected, account, wallet, disconnect, connect } = useWallet();
  const { isAuthenticated, isAuthenticating, authError, signIn } =
    useAptosAuth();
  const [pending, setPending] = useState<SupportedBrand | null>(null);

  const handleConnect = async (brand: SupportedBrand) => {
    setPending(brand);
    try {
      await connect(brand);
    } catch (err) {
      console.error("connect failed:", err);
    } finally {
      setPending(null);
    }
  };

  const addressStr = account?.address.toString();

  return (
    <>
      {connected && addressStr && (
        <div className="hidden sm:block px-3 py-1 rounded-pill bg-white/[0.05] border border-glass-border">
          <span className="text-xs text-white/40 mr-1.5">Balance</span>
          <span className="text-sm font-medium text-accent">
            {"—"}
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
        <div className="flex items-center gap-2">
          {SUPPORTED_BRANDS.map((brand) => (
            <BrandButton
              key={brand}
              brand={brand}
              onConnect={handleConnect}
              pending={pending}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function NavbarMobileWalletItems({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  const { connected } = useWallet();

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
      {connected && (
        <div className="text-sm py-2">
          <span className="text-white/40">Balance: </span>
          <span className="text-accent font-medium">{"—"}</span>
        </div>
      )}
    </>
  );
}
