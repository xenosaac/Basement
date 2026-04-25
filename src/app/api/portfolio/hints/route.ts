import { NextRequest, NextResponse } from "next/server";
import { getVerifiedAddress } from "@/lib/auth";
import { db } from "@/db";
import { portfolioCaseHints } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Client-driven case-discovery hint. Written after the trade tx confirms so
 * `/api/portfolio/cases` can surface the case before the vault_events
 * indexer catches up. Discovery only — never a source of truth for
 * balances or shares.
 */
export async function POST(request: NextRequest) {
  const address = await getVerifiedAddress(request);
  if (!address) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const caseIdRaw = (body as { caseId?: unknown })?.caseId;
  const txnHashRaw = (body as { txnHash?: unknown })?.txnHash;

  if (typeof caseIdRaw !== "string" || typeof txnHashRaw !== "string") {
    return NextResponse.json(
      { error: "caseId and txnHash must be strings" },
      { status: 400 },
    );
  }

  let caseId: bigint;
  try {
    caseId = BigInt(caseIdRaw);
  } catch {
    return NextResponse.json({ error: "caseId must be a bigint string" }, { status: 400 });
  }
  if (caseId <= 0n) {
    return NextResponse.json({ error: "caseId must be positive" }, { status: 400 });
  }
  if (txnHashRaw.length === 0 || txnHashRaw.length > 128) {
    return NextResponse.json({ error: "invalid txnHash" }, { status: 400 });
  }

  await db
    .insert(portfolioCaseHints)
    .values({
      userAddress: address,
      caseId,
      txnHash: txnHashRaw,
    })
    .onConflictDoNothing({
      target: [portfolioCaseHints.userAddress, portfolioCaseHints.caseId],
    });

  return NextResponse.json({ ok: true });
}
