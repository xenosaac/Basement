"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import {
  APTOS_AUTH_CHAIN_ID,
  AUTH_STATEMENT,
  getAuthChainId,
} from "@/lib/constants";

interface AuthSession {
  address: string;
  walletName: string | null;
}

interface AptosAuthContextValue {
  session: AuthSession | null;
  address: string | null;
  walletName: string | null;
  isConnected: boolean;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  authError: Error | null;
  /** Advisory capability: does the connected wallet support fee-payer sponsored tx? */
  supportsFeePayer: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AptosAuthContext = createContext<AptosAuthContextValue | null>(null);

function buildAuthMessage(args: {
  domain: string;
  chainId: number;
  nonce: string;
  address: string;
  statement: string;
}): string {
  const { domain, chainId, nonce, address, statement } = args;
  return [
    `domain: ${domain}`,
    `chainId: ${chainId}`,
    `nonce: ${nonce}`,
    `address: ${address}`,
    `statement: ${statement}`,
  ].join("\n");
}

function detectFeePayerSupport(walletName: string | undefined | null): boolean {
  // Advisory — Petra is the reference AIP-62 implementation and supports
  // signTransaction({asFeePayer:true}) natively. OKX fee-payer support
  // is unconfirmed (see docs/aptos-research/02-wallets.md §OKX).
  if (!walletName) return false;
  if (walletName === "Petra") return true;
  return false;
}

export function AptosAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { account, connected, wallet, signMessage, disconnect } = useWallet();
  const address = account?.address?.toString() ?? null;
  const walletName = wallet?.name ?? null;

  const [session, setSession] = useState<AuthSession | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<Error | null>(null);
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const attemptedAddressRef = useRef<string | null>(null);

  const supportsFeePayer = useMemo(
    () => detectFeePayerSupport(walletName),
    [walletName],
  );

  // Bootstrap: on mount, check if we already have a session cookie.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { address?: string };
          if (data.address) {
            setSession({
              address: data.address,
              walletName: walletName ?? null,
            });
          }
        }
      } catch {
        // ignore — treat as unauthenticated
      } finally {
        if (!cancelled) setIsBootstrapped(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `walletName` intentionally not in deps — we only hydrate once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async () => {
    if (!address) {
      setAuthError(new Error("Connect wallet first"));
      return;
    }
    if (isAuthenticating) return;
    setAuthError(null);
    setIsAuthenticating(true);
    try {
      const nonceRes = await fetch(
        `/api/auth/nonce?address=${encodeURIComponent(address)}`,
        { cache: "no-store" },
      );
      const nonceData = (await nonceRes.json()) as { nonce?: string; error?: string };
      if (!nonceRes.ok || !nonceData.nonce) {
        throw new Error(nonceData.error ?? "Failed to fetch nonce");
      }
      const nonce = nonceData.nonce;

      const domain =
        process.env.NEXT_PUBLIC_AUTH_DOMAIN ??
        (typeof window !== "undefined" ? window.location.host : "basement");
      const chainId = getAuthChainId();
      const message = buildAuthMessage({
        domain,
        chainId,
        nonce,
        address,
        statement: AUTH_STATEMENT,
      });

      // Wallet adapter signMessage wraps the message with an APTOS\n prefix
      // and appends nonce. We pass our 5-field message as `message` and the
      // nonce separately; `fullMessage` returned by the wallet contains both.
      const signed = await signMessage({ message, nonce });

      // AptosSignMessageOutput shape depends on wallet; some return
      // `address` + `publicKey`, others return only signature+fullMessage.
      // We pull the public key from the connected account if absent.
      const publicKeyFromAccount = account?.publicKey?.toString();
      const publicKey = publicKeyFromAccount;
      if (!publicKey) {
        throw new Error("Wallet did not expose a public key");
      }

      const fullMessage = signed.fullMessage;
      const signature = signed.signature.toString();

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          publicKey,
          signature,
          fullMessage,
          nonce,
        }),
      });
      const verifyData = (await verifyRes.json()) as {
        address?: string;
        error?: string;
      };
      if (!verifyRes.ok || !verifyData.address) {
        throw new Error(verifyData.error ?? "Verification failed");
      }

      setSession({
        address: verifyData.address,
        walletName: walletName ?? null,
      });
      attemptedAddressRef.current = address;
    } catch (err) {
      const wrapped =
        err instanceof Error ? err : new Error(String(err ?? "Unknown error"));
      setAuthError(wrapped);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const signOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore — best effort
    }
    setSession(null);
    attemptedAddressRef.current = null;
    try {
      disconnect();
    } catch {
      // wallet may already be disconnected
    }
  };

  const sessionAddress = session?.address?.toLowerCase();
  const connectedAddress = address?.toLowerCase();
  const isAuthenticated =
    isBootstrapped &&
    !!connected &&
    !!sessionAddress &&
    !!connectedAddress &&
    sessionAddress === connectedAddress;

  // If the connected address changes to something that doesn't match the
  // session, clear the stale session.
  useEffect(() => {
    if (session && connectedAddress && sessionAddress !== connectedAddress) {
      setSession(null);
      attemptedAddressRef.current = null;
    }
  }, [session, sessionAddress, connectedAddress]);

  const value: AptosAuthContextValue = {
    session,
    address,
    walletName,
    isConnected: connected,
    isAuthenticated,
    isAuthenticating,
    authError,
    supportsFeePayer,
    signIn,
    signOut,
  };

  return (
    <AptosAuthContext.Provider value={value}>
      {children}
    </AptosAuthContext.Provider>
  );
}

export function useAptosAuth(): AptosAuthContextValue {
  const ctx = useContext(AptosAuthContext);
  if (!ctx) {
    throw new Error("useAptosAuth must be used within AptosAuthProvider");
  }
  return ctx;
}

// Chain-id fallback export used by modules that build auth messages.
export const AUTH_CHAIN_ID_FALLBACK = APTOS_AUTH_CHAIN_ID;
