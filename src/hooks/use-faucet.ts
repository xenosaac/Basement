"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

import type { InputEntryFunctionData } from "@aptos-labs/ts-sdk";
import {
  aptos,
  adminAddress,
  buildClaimFaucetTxn,
} from "@/lib/aptos";
import { portfolioAddressQueryKey } from "./use-portfolio-query";
import { FAUCET_AMOUNT } from "@/lib/constants";

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
  const { account, signTransaction } = useWallet();
  const address = account?.address?.toString() ?? undefined;
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");

  const { mutate: claim, isPending } = useMutation<
    { txnHash: string; claimed: number },
    Error
  >({
    mutationFn: async () => {
      if (!account) throw new Error("Connect your wallet first");

      // Build the sponsored transaction. Must set `withFeePayer: true` so the
      // wallet produces a sender authenticator that commits to the admin as
      // fee payer.
      const payload = buildClaimFaucetTxn();
      const rawTxn = await aptos.transaction.build.simple({
        sender: account.address,
        data: payload.data as InputEntryFunctionData,
        withFeePayer: true,
        options: {
          expireTimestamp: Math.floor(Date.now() / 1000) + 60,
        },
      });

      // Attach the faucet-admin public address so the wallet knows whose
      // signature it is delegating fee payment to.
      const { AccountAddress } = await import("@aptos-labs/ts-sdk");
      rawTxn.feePayerAddress = AccountAddress.fromString(adminAddress());

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
      queryClient.invalidateQueries({ queryKey: portfolioAddressQueryKey(address) });
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
