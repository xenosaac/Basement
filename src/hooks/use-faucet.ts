"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

import type { InputEntryFunctionData } from "@aptos-labs/ts-sdk";
import {
  aptos,
  buildClaimFaucetTxn,
} from "@/lib/aptos";
import { portfolioOnChainQueryKey } from "./use-portfolio-onchain";
import { FAUCET_AMOUNT } from "@/lib/constants";
import { useAptosAuth } from "@/components/aptos-auth-provider";

function bytesToHex(bytes: Uint8Array): string {
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

interface SponsorResponse {
  success?: boolean;
  txnHash?: string;
  error?: string;
}

export function useFaucet() {
  const { account, signTransaction, signAndSubmitTransaction } = useWallet();
  const { supportsFeePayer } = useAptosAuth();
  const address = account?.address?.toString() ?? undefined;
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");

  const { mutate: claim, isPending } = useMutation<
    { txnHash: string; claimed: number },
    Error
  >({
    mutationFn: async () => {
      if (!account) throw new Error("Connect your wallet first");

      // Wallet-capability split:
      //   Petra → sponsored (admin pays gas, user sees zero-gas magic).
      //   Everything else → direct claim (user pays own testnet gas ~0.0001 APT).
      // See src/components/aptos-auth-provider.tsx::detectFeePayerSupport for
      // why other wallets can't reliably attach a fee-payer authenticator.
      if (!supportsFeePayer) {
        const payload = buildClaimFaucetTxn();
        const result = await signAndSubmitTransaction({
          sender: account.address,
          data: payload.data as InputEntryFunctionData,
        });
        await aptos.waitForTransaction({ transactionHash: result.hash });
        return { txnHash: result.hash, claimed: FAUCET_AMOUNT };
      }

      // Sponsored path (Petra). `withFeePayer: true` is required so the wallet
      // produces a sender authenticator that commits to the admin as fee payer.
      const payload = buildClaimFaucetTxn();
      const rawTxn = await aptos.transaction.build.simple({
        sender: account.address,
        data: payload.data as InputEntryFunctionData,
        withFeePayer: true,
        options: {
          expireTimestamp: Math.floor(Date.now() / 1000) + 60,
        },
      });

      // Fetch the canonical fee-payer address from the server — it's derived
      // from the server-held faucet admin private key, so this can't drift
      // from the signer even if env vars rotate independently.
      const feePayerRes = await fetch("/api/faucet/sponsor", { cache: "no-store" });
      const feePayerData = (await feePayerRes.json().catch(() => ({}))) as {
        feePayerAddress?: string;
        error?: string;
      };
      if (!feePayerRes.ok || !feePayerData.feePayerAddress) {
        throw new Error(
          feePayerData.error ?? `faucet/sponsor GET returned ${feePayerRes.status}`,
        );
      }
      const { AccountAddress } = await import("@aptos-labs/ts-sdk");
      rawTxn.feePayerAddress = AccountAddress.fromString(feePayerData.feePayerAddress);

      const senderAuth = await signTransaction({
        transactionOrPayload: rawTxn,
      });

      const transactionBytesHex = bytesToHex(rawTxn.bcsToBytes());
      const senderAuthenticatorBytesHex = bytesToHex(
        senderAuth.authenticator.bcsToBytes()
      );

      const res = await fetch("/api/faucet/sponsor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          transactionBytesHex,
          senderAuthenticatorBytesHex,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as SponsorResponse;
      if (!res.ok || !data.success || !data.txnHash) {
        throw new Error(data.error ?? `faucet/sponsor returned ${res.status}`);
      }

      return { txnHash: data.txnHash, claimed: FAUCET_AMOUNT };
    },
    onSuccess: ({ claimed }) => {
      setMessage(`+${claimed} VirtualUSD`);
      queryClient.invalidateQueries({ queryKey: portfolioOnChainQueryKey(address) });
      queryClient.invalidateQueries({ queryKey: ["auth-session"] });
      setTimeout(() => setMessage(""), 3000);
    },
    onError: (err) => {
      setMessage(err.message);
      setTimeout(() => setMessage(""), 4000);
    },
  });

  return { claim, isPending, message };
}
