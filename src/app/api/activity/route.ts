import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ordersV3 } from "@/db/schema";
import type { ApiErrorResponse } from "@/lib/types/v3-api";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status = 400) {
  const body: ApiErrorResponse = { error: { code: code as never, message, detail: undefined as never } };
  return NextResponse.json(body, { status });
}

/** Anonymize an Aptos address: 0x1234...abcd. */
function shortAddr(a: string): string {
  if (!a.startsWith("0x") || a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const seriesId = sp.get("seriesId");
  const roundIdxStr = sp.get("roundIdx");
  const limit = Math.min(50, Number(sp.get("limit") ?? 20));

  if (!seriesId || !roundIdxStr) {
    return err("BAD_REQUEST", "seriesId and roundIdx required");
  }
  const roundIdx = Number(roundIdxStr);
  if (!Number.isInteger(roundIdx)) {
    return err("BAD_REQUEST", "roundIdx must be integer");
  }

  const rows = await db
    .select({
      orderId: ordersV3.orderId,
      userAddress: ordersV3.userAddress,
      side: ordersV3.side,
      amountCents: ordersV3.amountCents,
      sharesE8: ordersV3.sharesE8,
      isBuy: ordersV3.isBuy,
      placedAtSec: ordersV3.placedAtSec,
    })
    .from(ordersV3)
    .where(
      and(eq(ordersV3.seriesId, seriesId), eq(ordersV3.roundIdx, roundIdx)),
    )
    .orderBy(desc(ordersV3.placedAtSec))
    .limit(limit);

  return NextResponse.json({
    seriesId,
    roundIdx,
    trades: rows.map((r) => ({
      orderId: r.orderId,
      anonAddress: shortAddr(r.userAddress),
      side: r.side,
      isBuy: r.isBuy,
      amountCents: r.amountCents.toString(),
      sharesE8: r.sharesE8?.toString() ?? null,
      placedAtSec: Number(r.placedAtSec),
    })),
  });
}
