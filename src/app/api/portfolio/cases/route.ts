import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getVerifiedAddress } from "@/lib/auth";
import { db } from "@/db";
import { vaultEvents } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Return the set of on-chain case_ids the authenticated user has ever
 * interacted with (bought/sold/claimed). Source-of-truth = vault_events
 * indexer table; actual position shape is read live via aptos.ts readers
 * in the client hook.
 */
export async function GET(request: NextRequest) {
  const address = await getVerifiedAddress(request);
  if (!address) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const rows = await db
    .selectDistinct({ caseId: vaultEvents.caseId })
    .from(vaultEvents)
    .where(
      and(
        eq(vaultEvents.userAddress, address),
        inArray(vaultEvents.eventType, [
          "bought_yes",
          "bought_no",
          "sold_yes",
          "sold_no",
          "claimed",
        ]),
      ),
    );

  const caseIds = rows
    .map((r) => r.caseId)
    .filter((c): c is bigint => c !== null && c !== undefined)
    .map((c) => c.toString());

  return NextResponse.json({ caseIds });
}
