import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { faucetClaimsV3, userBalancesV3 } from "@/db/schema";
import { normalizeAptosAddress } from "@/lib/auth";
import type { BalanceResponse } from "@/lib/types/v3-api";

export const dynamic = "force-dynamic";

const FAUCET_COOLDOWN_SEC = 24 * 3600;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const addrRaw = url.searchParams.get("user");
  if (!addrRaw) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "user param required" } }, { status: 400 });
  }
  const address = normalizeAptosAddress(addrRaw);

  const [row] = await db
    .select()
    .from(userBalancesV3)
    .where(eq(userBalancesV3.address, address))
    .limit(1);

  const [lastFaucet] = await db
    .select({ claimedAtSec: faucetClaimsV3.claimedAtSec })
    .from(faucetClaimsV3)
    .where(eq(faucetClaimsV3.userAddress, address))
    .orderBy(desc(faucetClaimsV3.claimedAtSec))
    .limit(1);

  const nowSec = Math.floor(Date.now() / 1000);
  const nextFaucetAtSec = lastFaucet
    ? Number(lastFaucet.claimedAtSec) + FAUCET_COOLDOWN_SEC
    : null;

  const response: BalanceResponse = {
    userAddress: address,
    availableCents: (row?.availableCents ?? 0n).toString(),
    lockedCents: (row?.lockedCents ?? 0n).toString(),
    totalDepositsCents: (row?.totalDepositsCents ?? 0n).toString(),
    totalWithdrawalsCents: (row?.totalWithdrawalsCents ?? 0n).toString(),
    nextFaucetAtSec: nextFaucetAtSec && nextFaucetAtSec > nowSec ? nextFaucetAtSec : null,
  };
  return NextResponse.json(response);
}
