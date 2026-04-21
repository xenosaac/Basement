import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { FAUCET_AMOUNT, FAUCET_COOLDOWN_SECONDS } from "@/lib/constants";
import { requireAuth } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    // Verify wallet session
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const addr = auth.address;

    const [existing] = await db.select().from(users).where(eq(users.address, addr));

    if (existing?.faucetClaimedAt) {
      const cooldownMs = FAUCET_COOLDOWN_SECONDS * 1000;
      const elapsed = Date.now() - existing.faucetClaimedAt.getTime();
      if (elapsed < cooldownMs) {
        const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
        return NextResponse.json(
          { error: `Faucet on cooldown. Try again in ${remainingSec}s.` },
          { status: 429 }
        );
      }
    }

    const now = new Date();
    const newBalance = Number(existing?.balance ?? 0) + FAUCET_AMOUNT;

    await db
      .insert(users)
      .values({ address: addr, balance: String(newBalance), faucetClaimedAt: now })
      .onConflictDoUpdate({
        target: users.address,
        set: { balance: String(newBalance), faucetClaimedAt: now },
      });

    return NextResponse.json({ balance: newBalance, claimed: FAUCET_AMOUNT });
  } catch (error) {
    console.error("Faucet error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
