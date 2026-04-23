"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

import type { InputEntryFunctionData } from "@aptos-labs/ts-sdk";
import { aptos, buildClaimWinningsTxn } from "@/lib/aptos";
import { portfolioOnChainQueryKey } from "./use-portfolio-onchain";

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

export function useClaim(caseId: bigint | null) {
  const { account, signTransaction } = useWallet();
  const address = account?.address?.toString() ?? undefined;
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");

  const { mutate: claim, isPending } = useMutation<
    { txnHash: string },
    Error
  >({
    mutationFn: async () => {
      if (!account) throw new Error("Connect your wallet first");
      if (caseId === null) throw new Error("Missing caseId");

      // Build sponsored claim tx. claim_winnings is already in the
      // SPONSORED_INNER_ENTRY_ALLOWLIST on the server, so we reuse
      // /api/faucet/sponsor for submission.
      const payload = buildClaimWinningsTxn(caseId);
      const rawTxn = await aptos.transaction.build.simple({
        sender: account.address,
        data: payload.data as InputEntryFunctionData,
        withFeePayer: true,
        options: {
          expireTimestamp: Math.floor(Date.now() / 1000) + 60,
        },
      });

      // Fetch the canonical fee-payer address from the server.
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
        senderAuth.authenticator.bcsToBytes(),
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

      return { txnHash: data.txnHash };
    },
    onSuccess: () => {
      setMessage("Claimed");
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
