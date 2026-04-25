"use client";

import type { JSX } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  AdapterWallet,
  AdapterNotDetectedWallet,
} from "@aptos-labs/wallet-adapter-react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

/**
 * Global connect-modal context.
 *
 * Moved out of `navbar-wallet-controls.tsx` so that any descendant of the
 * auth stack (inline trade widgets, series cards, etc.) can call
 * `useConnectModal().open()` without prop drilling or `window.dispatchEvent`.
 *
 * MUST be mounted inside `<AptosAuthProvider>` so the wallet list inside
 * the dialog can consume `useWallet()` — see `wallet-providers.tsx`.
 */
export interface ConnectModalCtx {
  open(): void;
  close(): void;
  isOpen: boolean;
}

const ConnectModalContext = createContext<ConnectModalCtx | null>(null);

export function useConnectModal(): ConnectModalCtx {
  const ctx = useContext(ConnectModalContext);
  if (!ctx) {
    throw new Error(
      "useConnectModal must be used within ConnectModalProvider",
    );
  }
  return ctx;
}

type WalletRow = {
  name: string;
  icon?: string;
  url?: string;
  detected: boolean;
};

const SUPPORTED_BRANDS = [
  "OKX Wallet",
  "Bitget Wallet",
  "Petra",
  "Backpack",
  "Nightly",
];

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

function WalletRowItem({
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

  // SSR guard: `createPortal(..., document.body)` can only run on the client.
  useEffect(() => {
    setMounted(true);
  }, []);

  // ESC-to-close + body scroll lock while dialog is open.
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
    const ai = SUPPORTED_BRANDS.indexOf(a.name);
    const bi = SUPPORTED_BRANDS.indexOf(b.name);
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
              <WalletRowItem
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

export function ConnectModalProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo<ConnectModalCtx>(
    () => ({ open, close, isOpen }),
    [open, close, isOpen],
  );

  return (
    <ConnectModalContext.Provider value={value}>
      {children}
      <WalletConnectDialog open={isOpen} onClose={close} />
    </ConnectModalContext.Provider>
  );
}
