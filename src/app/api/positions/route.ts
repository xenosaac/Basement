import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { casesV3, positionsV3 } from "@/db/schema";
import { curvePrices } from "@/lib/v3-pricing";
import type { ApiErrorResponse, PositionsResponse } from "@/lib/types/v3-api";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status = 400) {
  const body: ApiErrorResponse = { error: { code: code as never, message, detail: undefined as never } };
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const user = sp.get("user");
  if (!user) return err("BAD_REQUEST", "user required");

  // Pull every position the user has ever touched (open or settled). Total
  // realized P&L sums across all of them; the response list is filtered down
  // to OPEN + CLAIMABLE for display below.
  const rows = await db
    .select({
      seriesId: positionsV3.seriesId,
      roundIdx: positionsV3.roundIdx,
      side: positionsV3.side,
      sharesE8: positionsV3.sharesE8,
      costBasisCents: positionsV3.costBasisCents,
      realizedPnlCents: positionsV3.realizedPnlCents,
      claimedAt: positionsV3.claimedAt,
      caseState: casesV3.state,
      resolvedOutcome: casesV3.resolvedOutcome,
      upSharesE8: casesV3.upSharesE8,
      downSharesE8: casesV3.downSharesE8,
    })
    .from(positionsV3)
    .leftJoin(
      casesV3,
      and(
        eq(positionsV3.seriesId, casesV3.seriesId),
        eq(positionsV3.roundIdx, casesV3.roundIdx),
      ),
    )
    .where(
      and(
        eq(positionsV3.userAddress, user),
        or(
          sql`${positionsV3.sharesE8} > 0`,
          ne(positionsV3.realizedPnlCents, 0n),
        ),
      ),
    )
    .orderBy(desc(positionsV3.updatedAt));

  let totalMark = 0n;
  let totalRealized = 0n;
  const positions = rows.map((r) => {
    const isOpenCase = r.caseState === "OPEN";
    const isResolved = r.caseState === "RESOLVED" || r.caseState === "VOID";
    const isClaimable =
      isResolved && r.claimedAt == null && r.realizedPnlCents > 0n;

    let status: "OPEN" | "CLAIMABLE" | "CLAIMED" | "LOST";
    if (isOpenCase && r.sharesE8 > 0n) {
      status = "OPEN";
    } else if (isClaimable) {
      status = "CLAIMABLE";
    } else if (isResolved && r.realizedPnlCents > 0n && r.claimedAt != null) {
      status = "CLAIMED";
    } else {
      status = "LOST";
    }

    let markValueCents: bigint | null = null;
    let unrealizedPnlCents: bigint | null = null;
    if (status === "OPEN" && r.upSharesE8 != null && r.downSharesE8 != null) {
      const prices = curvePrices(r.upSharesE8, r.downSharesE8);
      const sidePriceCents = r.side === "UP" ? prices.upCents : prices.downCents;
      markValueCents = (r.sharesE8 * BigInt(sidePriceCents)) / 100_000_000n;
      unrealizedPnlCents = markValueCents - r.costBasisCents;
      totalMark += markValueCents;
    }

    // Lifetime realized P&L includes both claimed and unclaimed-but-resolved
    // positions — the outcome is locked at resolve time.
    totalRealized += r.realizedPnlCents;

    return {
      seriesId: r.seriesId,
      roundIdx: Number(r.roundIdx),
      side: r.side as "UP" | "DOWN",
      sharesE8: r.sharesE8.toString(),
      costBasisCents: r.costBasisCents.toString(),
      realizedPnlCents: r.realizedPnlCents.toString(),
      markValueCents: markValueCents?.toString() ?? null,
      unrealizedPnlCents: unrealizedPnlCents?.toString() ?? null,
      claimedAt: r.claimedAt?.toISOString() ?? null,
      status,
      // Settle value for claimable rows (cost basis + realized P&L). UI uses
      // this on the Claim button.
      claimableCents: status === "CLAIMABLE"
        ? (r.costBasisCents + r.realizedPnlCents).toString()
        : null,
    };
  });

  // Hide CLAIMED + LOST rows from the response list (they bloat UI). They've
  // already contributed to totalRealized.
  const visible = positions.filter(
    (p) => p.status === "OPEN" || p.status === "CLAIMABLE",
  );

  const response: PositionsResponse = {
    positions: visible,
    totalMarkValueCents: totalMark.toString(),
    totalRealizedPnlCents: totalRealized.toString(),
  };
  return NextResponse.json(response);
}
