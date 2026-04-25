import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { casesV3 } from "@/db/schema";
import { curvePrices, quoteBuy, quoteSell } from "@/lib/quant";
import type { ApiErrorResponse, QuoteResponse } from "@/lib/types/v3-api";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status = 400) {
  const body: ApiErrorResponse = { error: { code: code as never, message, detail: undefined as never } };
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const seriesId = sp.get("seriesId");
  const roundIdxStr = sp.get("roundIdx");
  const sideStr = sp.get("side");
  const amountCentsStr = sp.get("amountCents");
  const sharesE8Str = sp.get("sharesE8");

  if (!seriesId || !roundIdxStr) {
    return err("BAD_REQUEST", "seriesId, roundIdx required");
  }
  const roundIdx = Number(roundIdxStr);
  if (!Number.isInteger(roundIdx)) {
    return err("BAD_REQUEST", "roundIdx must be integer");
  }

  const [caseRow] = await db
    .select({
      upSharesE8: casesV3.upSharesE8,
      downSharesE8: casesV3.downSharesE8,
    })
    .from(casesV3)
    .where(and(eq(casesV3.seriesId, seriesId), eq(casesV3.roundIdx, roundIdx)))
    .limit(1);

  // Pool defaults to (0, 0) if case not yet spawned — still a valid quote at
  // the seed state so the UI can preview.
  const upShares = caseRow?.upSharesE8 ?? 0n;
  const downShares = caseRow?.downSharesE8 ?? 0n;

  const prices = curvePrices(upShares, downShares);

  const side = sideStr === "UP" || sideStr === "DOWN" ? sideStr : null;

  let buyOut: QuoteResponse["buy"] = null;
  if (side && amountCentsStr) {
    const amount = BigInt(amountCentsStr);
    if (amount > 0n) {
      try {
        const q = quoteBuy(upShares, downShares, side, amount);
        buyOut = {
          sharesE8: q.sharesE8.toString(),
          avgPriceCents: q.avgPriceCents,
          upPriceCentsAfter: q.upPriceCentsAfter,
          downPriceCentsAfter: q.downPriceCentsAfter,
        };
      } catch {
        // ignore — return null buy quote
      }
    }
  }

  let sellOut: QuoteResponse["sell"] = null;
  if (side && sharesE8Str) {
    const shares = BigInt(sharesE8Str);
    if (shares > 0n) {
      try {
        const q = quoteSell(upShares, downShares, side, shares);
        sellOut = {
          proceedsCents: q.proceedsCents.toString(),
          pricePerShareCents: q.pricePerShareCents,
          upPriceCentsAfter: q.upPriceCentsAfter,
          downPriceCentsAfter: q.downPriceCentsAfter,
        };
      } catch {
        // ignore
      }
    }
  }

  const response: QuoteResponse = {
    seriesId,
    roundIdx,
    upCents: prices.upCents,
    downCents: prices.downCents,
    buy: buyOut,
    sell: sellOut,
  };
  return NextResponse.json(response);
}
