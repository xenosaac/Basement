import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { casesV3, ordersV3 } from "@/db/schema";
import {
  buy as pmBuy,
  sell as pmSell,
  initialReserves,
  Phi,
  zOf,
} from "@/lib/pm-amm";
import type { ApiErrorResponse } from "@/lib/types/v3-api";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status = 400) {
  const body: ApiErrorResponse = { error: { code: code as never, message, detail: undefined as never } };
  return NextResponse.json(body, { status });
}

interface CurvePoint {
  t: number; // unix sec
  upCents: number; // 0..100
  downCents: number;
}

/**
 * Replay all orders for (seriesId, roundIdx) in chronological order through
 * pm-amm. Returns time-series of YES/NO marginal prices.
 *
 * Live rounds: appended (now, current price) anchor.
 * Resolved rounds: appended (closeTimeSec, frozen final price) anchor.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const seriesId = sp.get("seriesId");
  const roundIdxStr = sp.get("roundIdx");
  if (!seriesId || !roundIdxStr) {
    return err("BAD_REQUEST", "seriesId and roundIdx required");
  }
  const roundIdx = Number(roundIdxStr);
  if (!Number.isInteger(roundIdx)) {
    return err("BAD_REQUEST", "roundIdx must be integer");
  }

  const [caseRow] = await db
    .select({
      startTimeSec: casesV3.startTimeSec,
      closeTimeSec: casesV3.closeTimeSec,
      state: casesV3.state,
      resolvedOutcome: casesV3.resolvedOutcome,
    })
    .from(casesV3)
    .where(and(eq(casesV3.seriesId, seriesId), eq(casesV3.roundIdx, roundIdx)))
    .limit(1);
  if (!caseRow) {
    return err("CASE_NOT_FOUND", "Round does not exist", 404);
  }

  const orders = await db
    .select({
      side: ordersV3.side,
      isBuy: ordersV3.isBuy,
      amountCents: ordersV3.amountCents,
      sharesE8: ordersV3.sharesE8,
      placedAtSec: ordersV3.placedAtSec,
    })
    .from(ordersV3)
    .where(and(eq(ordersV3.seriesId, seriesId), eq(ordersV3.roundIdx, roundIdx)))
    .orderBy(asc(ordersV3.placedAtSec));

  const startSec = Number(caseRow.startTimeSec);
  const closeSec = Number(caseRow.closeTimeSec);
  const isResolved = caseRow.state === "RESOLVED" || caseRow.state === "VOID";

  // Initial state at round start: 50/50.
  let { x, y } = initialReserves();
  const points: CurvePoint[] = [
    { t: startSec, upCents: 50, downCents: 50 },
  ];

  for (const o of orders) {
    if (o.sharesE8 == null) continue; // skip legacy parimutuel rows
    const ammSide = o.side === "UP" ? "YES" : "NO";
    try {
      if (o.isBuy === 1) {
        const r = pmBuy(x, y, ammSide, Number(o.amountCents) / 100);
        x = r.newX;
        y = r.newY;
      } else {
        const r = pmSell(x, y, ammSide, Number(o.sharesE8) / 1e8);
        x = r.newX;
        y = r.newY;
      }
    } catch {
      // skip malformed order
      continue;
    }
    const z = zOf(x, y);
    const upPrice = Phi(z);
    points.push({
      t: Number(o.placedAtSec),
      upCents: Math.round(upPrice * 100),
      downCents: Math.round((1 - upPrice) * 100),
    });
  }

  // Anchor end of curve.
  const z = zOf(x, y);
  const currentUp = Math.round(Phi(z) * 100);
  const currentDown = 100 - currentUp;
  const nowSec = Math.floor(Date.now() / 1000);
  const endT = isResolved ? closeSec : Math.min(nowSec, closeSec);
  if (endT > points[points.length - 1].t) {
    points.push({ t: endT, upCents: currentUp, downCents: currentDown });
  }

  const headers: HeadersInit = isResolved
    ? { "Cache-Control": "public, max-age=3600" }
    : { "Cache-Control": "no-store" };

  return NextResponse.json(
    {
      seriesId,
      roundIdx,
      startTimeSec: startSec,
      closeTimeSec: closeSec,
      state: caseRow.state,
      resolvedOutcome: caseRow.resolvedOutcome,
      points,
      current: { upCents: currentUp, downCents: currentDown },
    },
    { headers },
  );
}
