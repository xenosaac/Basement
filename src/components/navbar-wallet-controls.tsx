"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { AdapterWallet, AdapterNotDetectedWallet } from "@aptos-labs/wallet-adapter-react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useAptosAuth } from "./aptos-auth-provider";
import { usePortfolio } from "@/hooks/use-portfolio";
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

type WalletRow = {
  name: string;
  icon?: string;
  url?: string;
  detected: boolean;
};

function WalletIcon({ icon, name }: { icon?: string; name: string }) {
  if (icon) {
    return (
      <div className="h-11 w-11 rounded-xl overflow-hidden bg-white/[0.05] p-0.5 flex items-center justify-center flex-shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={icon} alt={name} className="h-full w-full object-contain" />
      </div>
    );
  }
  return (
    <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-white/[0.1] to-white/[0.03] flex items-center justify-center text-white/70 font-semibold flex-shrink-0">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function WalletRow({
  row,
  onConnect,
  pending,
}: {
  row: WalletRow;
  onConnect: (name: string) => void;
  pending: string | null;
}) {
  const isPending = pending === row.name;

  const handleClick = () => {
    if (isPending) return;
    if (row.detected) {
      onConnect(row.name);
    } else if (row.url) {
      window.open(row.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="flex items-center gap-3 p-3 rounded-2xl hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait w-full text-left"
    >
      <WalletIcon icon={row.icon} name={row.name} />
      <span className="text-[15px] font-medium text-white flex-1">
        {row.name}
      </span>
      {isPending ? (
        <span className="text-xs text-white/50">Connecting…</span>
      ) : row.detected ? (
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-xs text-white/50">Installed</span>
        </span>
      ) : (
        <span className="text-xs text-white/40">Install →</span>
      )}
    </button>
  );
}

function WalletConnectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { wallets = [], notDetectedWallets = [], connect } = useWallet();
  const [pending, setPending] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !mounted || typeof window === "undefined") return null;

  const WALLET_ORDER = [
    "OKX Wallet",
    "Bitget Wallet",
    "Petra",
    "Backpack",
    "Nightly",
  ];

  const rows: WalletRow[] = [
    ...wallets.map((w: AdapterWallet) => ({
      name: w.name,
      icon: w.icon,
      url: w.url,
      detected: true,
    })),
    ...notDetectedWallets.map((w: AdapterNotDetectedWallet) => ({
      name: w.name,
      icon: w.icon,
      url: w.url,
      detected: false,
    })),
  ].sort((a, b) => {
    const ai = WALLET_ORDER.indexOf(a.name);
    const bi = WALLET_ORDER.indexOf(b.name);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const handleConnect = async (name: string) => {
    setPending(name);
    try {
      await connect(name);
      onClose();
    } catch (err) {
      console.error("connect failed:", err);
    } finally {
      setPending(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connect a wallet"
        className="relative w-[min(400px,92vw)] rounded-[28px] border border-white/[0.08] bg-[rgba(17,17,19,0.9)] backdrop-blur-2xl shadow-2xl shadow-black/50 p-6 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 h-8 w-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white/70 hover:text-white transition-colors flex items-center justify-center text-lg"
        >
          ×
        </button>

        <div className="text-center pb-2">
          <h2 className="text-[18px] font-semibold text-white">
            Connect a Wallet
          </h2>
          <p className="text-sm text-white/50 mt-1">
            Choose a wallet to continue
          </p>
        </div>

        <div className="flex flex-col gap-2 mt-4">
          {rows.length === 0 ? (
            <div className="text-center py-8 text-sm text-white/40">
              No wallets available. Install one to continue.
            </div>
          ) : (
            rows.map((row) => (
              <WalletRow
                key={row.name}
                row={row}
                onConnect={handleConnect}
                pending={pending}
              />
            ))
          )}
        </div>

        <div className="border-t border-white/[0.06] pt-4 mt-4 text-center">
          <a
            href="https://aptos.dev/en/network/blockchain/accounts"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-white/40 hover:text-white/60 transition-colors"
          >
            New to Aptos? Learn more about wallets →
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function NavbarWalletControls() {
  const { connected, account, wallet, disconnect } = useWallet();
  const { isAuthenticated, isAuthenticating, authError, signIn } =
    useAptosAuth();
  const { data: portfolio } = usePortfolio();
  const [dialogOpen, setDialogOpen] = useState(false);

  const addressStr = account?.address.toString();
  // TEMPORARY: reads v0 DB balance; Session D rewires to on-chain FA.
  const balance = portfolio?.balance ?? 0;

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
        <>
          <button
            onClick={() => setDialogOpen(true)}
            className="px-4 py-1.5 rounded-pill bg-white text-black text-sm font-medium hover:bg-white/90 transition-colors"
          >
            Connect Wallet
          </button>
          <WalletConnectDialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
          />
        </>
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
  const { isAuthenticated } = useAptosAuth();
  const { data: portfolio } = usePortfolio();
  const balance = portfolio?.balance ?? 0;

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
          <span className="text-white/40">Balance: </span>
          <span className="text-accent font-medium">{formatUSD(balance)}</span>
        </div>
      )}
    </>
  );
}
