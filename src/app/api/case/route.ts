import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { casesV3, ordersV3, positionsV3 } from "@/db/schema";
import { getSeries } from "@/lib/series-config";
import { curvePrices } from "@/lib/quant";
import type { ApiErrorResponse } from "@/lib/types/v3-api";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status = 400) {
  const body: ApiErrorResponse = { error: { code: code as never, message, detail: undefined as never } };
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const seriesId = sp.get("seriesId");
  const roundIdxStr = sp.get("roundIdx");
  const user = sp.get("user");

  if (!seriesId || !roundIdxStr) {
    return err("BAD_REQUEST", "seriesId and roundIdx required");
  }
  const roundIdx = Number(roundIdxStr);
  if (!Number.isInteger(roundIdx)) {
    return err("BAD_REQUEST", "roundIdx must be integer");
  }

  const seriesCfg = getSeries(seriesId);
  const [caseRow] = await db
    .select()
    .from(casesV3)
    .where(and(eq(casesV3.seriesId, seriesId), eq(casesV3.roundIdx, roundIdx)))
    .limit(1);

  if (!caseRow) {
    return err("CASE_NOT_FOUND", `Round ${roundIdx} not found for ${seriesId}`, 404);
  }

  const myOrders = user
    ? await db
        .select()
        .from(ordersV3)
        .where(
          and(
            eq(ordersV3.seriesId, seriesId),
            eq(ordersV3.roundIdx, roundIdx),
            eq(ordersV3.userAddress, user),
          ),
        )
        .orderBy(ordersV3.placedAtSec)
    : [];

  const myPositions = user
    ? await db
        .select({
          side: positionsV3.side,
          sharesE8: positionsV3.sharesE8,
          costBasisCents: positionsV3.costBasisCents,
          realizedPnlCents: positionsV3.realizedPnlCents,
        })
        .from(positionsV3)
        .where(
          and(
            eq(positionsV3.userAddress, user),
            eq(positionsV3.seriesId, seriesId),
            eq(positionsV3.roundIdx, roundIdx),
            gt(positionsV3.sharesE8, 0n),
          ),
        )
    : [];

  const livePrices =
    caseRow.state === "OPEN"
      ? curvePrices(caseRow.upSharesE8, caseRow.downSharesE8)
      : null;

  return NextResponse.json({
    seriesId,
    roundIdx,
    pair: seriesCfg?.pair ?? null,
    cadenceSec: seriesCfg?.cadenceSec ?? null,
    startTimeSec: Number(caseRow.startTimeSec),
    closeTimeSec: Number(caseRow.closeTimeSec),
    strikePriceE8: caseRow.strikePriceE8?.toString() ?? null,
    strikeCents: caseRow.strikeCents?.toString() ?? null,
    resolvedPriceE8: caseRow.resolvedPriceE8?.toString() ?? null,
    resolvedOutcome: caseRow.resolvedOutcome,
    resolvedAt: caseRow.resolvedAt?.toISOString() ?? null,
    state: caseRow.state,
    upPoolCents: caseRow.upPoolCents.toString(),
    downPoolCents: caseRow.downPoolCents.toString(),
    upSharesE8: caseRow.upSharesE8.toString(),
    downSharesE8: caseRow.downSharesE8.toString(),
    livePrices,
    myPositions: myPositions.map((p) => ({
      side: p.side as "UP" | "DOWN",
      sharesE8: p.sharesE8.toString(),
      costBasisCents: p.costBasisCents.toString(),
      realizedPnlCents: p.realizedPnlCents.toString(),
    })),
    myOrders: myOrders.map((o) => ({
      orderId: o.orderId,
      side: o.side,
      amountCents: o.amountCents.toString(),
      sharesE8: o.sharesE8?.toString() ?? null,
      isBuy: o.isBuy,
      placedAtSec: Number(o.placedAtSec),
      payoutCents: o.payoutCents?.toString() ?? null,
    })),
  });
}
