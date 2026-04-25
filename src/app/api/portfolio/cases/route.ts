import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getVerifiedAddress } from "@/lib/auth";
import { db } from "@/db";
import { portfolioCaseHints, vaultEvents } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Return the set of on-chain case_ids the authenticated user has ever
 * interacted with — union of:
 *   1. vault_events rows (authoritative once the indexer has caught up)
 *   2. portfolio_case_hints rows (written client-side on confirmed tx,
 *      lets the UI discover a case before the indexer sees it)
 *
 * Discovery only — actual position shape (shares, resolved state) is read
 * live via aptos.ts readers in the client hook. Hints never imply balance.
 */
export async function GET(request: NextRequest) {
  const address = await getVerifiedAddress(request);
  if (!address) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const [eventRows, hintRows] = await Promise.all([
    db
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
      ),
    db
      .selectDistinct({ caseId: portfolioCaseHints.caseId })
      .from(portfolioCaseHints)
      .where(eq(portfolioCaseHints.userAddress, address)),
  ]);

  const set = new Set<string>();
  for (const r of eventRows) {
    if (r.caseId != null) set.add(r.caseId.toString());
  }
  for (const r of hintRows) {
    if (r.caseId != null) set.add(r.caseId.toString());
  }

  return NextResponse.json({ caseIds: Array.from(set) });
}
