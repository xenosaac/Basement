import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { portfolioAddressQueryKey } from "./use-portfolio-query";

export function useFaucet() {
  const { account } = useWallet();
  const address = account?.address?.toString() ?? undefined;
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");

  const { mutate: claim, isPending } = useMutation<
    { balance: number; claimed: number },
    Error
  >({
    mutationFn: async () => {
      const res = await fetch("/api/faucet", {
        method: "POST",
        cache: "no-store",
      });

      let data: { error?: string; balance?: number; claimed?: number } | null = null;

      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        throw new Error(data?.error || "Failed to claim VirtualUSD");
      }

      if (typeof data?.balance !== "number" || typeof data?.claimed !== "number") {
        throw new Error("Invalid faucet response");
      }

      return data as { balance: number; claimed: number };
    },
    onSuccess: (data) => {
      setMessage(`+${data.claimed} VirtualUSD`);
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
