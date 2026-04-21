import { NextRequest, NextResponse } from "next/server";
import { getVerifiedAddress } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const address = await getVerifiedAddress(request);
  if (!address) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const [user] = await db
    .select({ balance: users.balance, faucetClaimedAt: users.faucetClaimedAt })
    .from(users)
    .where(eq(users.address, address));

  return NextResponse.json({
    authenticated: true,
    address,
    balance: Number(user?.balance ?? 0),
    faucetClaimedAt: user?.faucetClaimedAt?.toISOString() ?? null,
  });
}
