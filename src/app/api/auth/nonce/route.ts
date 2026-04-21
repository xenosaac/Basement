import { NextRequest, NextResponse } from "next/server";
import { issueNonce } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/nonce?address=0x...
 *
 * STUB: nonces live in an in-memory Map for Session A.
 * Session C will migrate to a Postgres `auth_nonces` table.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address") ?? undefined;
  const nonce = issueNonce(address);
  return NextResponse.json({ nonce });
}
