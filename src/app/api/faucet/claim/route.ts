import { NextRequest, NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { faucetClaimsV3, userBalancesV3 } from "@/db/schema";
import { getVerifiedAddress } from "@/lib/auth";
import type { ApiErrorResponse, FaucetResponse } from "@/lib/types/v3-api";

export const dynamic = "force-dynamic";

const FAUCET_CREDIT_CENTS = 5000n; // $50
const FAUCET_COOLDOWN_SEC = 24 * 3600;

function err(code: string, message: string, status = 400, detail?: unknown) {
  const body: ApiErrorResponse = { error: { code: code as never, message, detail: detail as never } };
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  const address = await getVerifiedAddress(request);
  if (!address) return err("UNAUTHORIZED", "Sign in with wallet first", 401);

  const nowSec = Math.floor(Date.now() / 1000);

  try {
    const result = await db.transaction(
      async (tx) => {
        const [lastClaim] = await tx
          .select({ claimedAtSec: faucetClaimsV3.claimedAtSec })
          .from(faucetClaimsV3)
          .where(eq(faucetClaimsV3.userAddress, address))
          .orderBy(desc(faucetClaimsV3.claimedAtSec))
          .limit(1);

        if (lastClaim) {
          const nextAt = Number(lastClaim.claimedAtSec) + FAUCET_COOLDOWN_SEC;
          if (nextAt > nowSec) {
            throw { _err: true, code: "FAUCET_COOLDOWN", detail: { nextClaimAtSec: nextAt } };
          }
        }

        await tx
          .insert(userBalancesV3)
          .values({
            address,
            availableCents: FAUCET_CREDIT_CENTS,
            totalDepositsCents: FAUCET_CREDIT_CENTS,
          })
          .onConflictDoUpdate({
            target: userBalancesV3.address,
            set: {
              availableCents: sql`${userBalancesV3.availableCents} + ${FAUCET_CREDIT_CENTS}`,
              totalDepositsCents: sql`${userBalancesV3.totalDepositsCents} + ${FAUCET_CREDIT_CENTS}`,
              updatedAt: new Date(),
            },
          });

        await tx.insert(faucetClaimsV3).values({
          userAddress: address,
          amountCents: FAUCET_CREDIT_CENTS,
          claimedAtSec: nowSec,
        });

        const [updated] = await tx
          .select({ availableCents: userBalancesV3.availableCents })
          .from(userBalancesV3)
          .where(eq(userBalancesV3.address, address))
          .limit(1);
        return {
          newAvailableCents: updated.availableCents.toString(),
          nextClaimAtSec: nowSec + FAUCET_COOLDOWN_SEC,
        };
      },
      { isolationLevel: "serializable" },
    );

    const response: FaucetResponse = {
      creditedCents: FAUCET_CREDIT_CENTS.toString(),
      newAvailableCents: result.newAvailableCents,
      nextClaimAtSec: result.nextClaimAtSec,
    };
    return NextResponse.json(response);
  } catch (e) {
    const asErr = e as { _err?: boolean; code?: string; detail?: unknown };
    if (asErr?._err && asErr.code === "FAUCET_COOLDOWN") {
      const detail = asErr.detail as { nextClaimAtSec: number };
      const hoursLeft = Math.ceil((detail.nextClaimAtSec - nowSec) / 3600);
      return err(
        "FAUCET_COOLDOWN",
        `Faucet available in ${hoursLeft}h`,
        429,
        detail,
      );
    }
    console.error("faucet error:", e);
    return err("INTERNAL", "Faucet claim failed", 500);
  }
}
