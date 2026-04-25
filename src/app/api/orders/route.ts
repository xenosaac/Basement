import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { casesV3, ordersV3 } from "@/db/schema";
import { normalizeAptosAddress } from "@/lib/auth";
import type { OrdersResponse } from "@/lib/types/v3-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const addrRaw = url.searchParams.get("user");
  if (!addrRaw) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "user param required" } },
      { status: 400 },
    );
  }
  const address = normalizeAptosAddress(addrRaw);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10), 1),
    200,
  );

  // Join orders with case state
  const rows = await db
    .select({
      orderId: ordersV3.orderId,
      userAddress: ordersV3.userAddress,
      seriesId: ordersV3.seriesId,
      roundIdx: ordersV3.roundIdx,
      side: ordersV3.side,
      amountCents: ordersV3.amountCents,
      sharesE8: ordersV3.sharesE8,
      isBuy: ordersV3.isBuy,
      placedAtSec: ordersV3.placedAtSec,
      payoutCents: ordersV3.payoutCents,
      caseState: casesV3.state,
      resolvedOutcome: casesV3.resolvedOutcome,
    })
    .from(ordersV3)
    .leftJoin(
      casesV3,
      and(
        eq(casesV3.seriesId, ordersV3.seriesId),
        eq(casesV3.roundIdx, ordersV3.roundIdx),
      ),
    )
    .where(eq(ordersV3.userAddress, address))
    .orderBy(desc(ordersV3.placedAtSec))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;

  const response: OrdersResponse = {
    orders: sliced.map((r) => ({
      orderId: r.orderId,
      userAddress: r.userAddress,
      seriesId: r.seriesId as never,
      roundIdx: Number(r.roundIdx),
      side: r.side as "UP" | "DOWN",
      amountCents: r.amountCents.toString(),
      sharesE8: r.sharesE8?.toString() ?? null,
      isBuy: (Number(r.isBuy) === 0 ? 0 : 1) as 0 | 1,
      placedAtSec: Number(r.placedAtSec),
      caseState: (r.caseState ?? "OPEN") as never,
      resolvedOutcome: (r.resolvedOutcome ?? null) as never,
      payoutCents: r.payoutCents?.toString() ?? null,
    })),
    hasMore,
  };
  return NextResponse.json(response);
}
