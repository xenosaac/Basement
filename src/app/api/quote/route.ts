import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { casesV3 } from "@/db/schema";
import { curvePrices, quoteBuy, quoteSell, sharesE8ToCents } from "@/lib/quant";
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
      state: casesV3.state,
      resolvedOutcome: casesV3.resolvedOutcome,
    })
    .from(casesV3)
    .where(and(eq(casesV3.seriesId, seriesId), eq(casesV3.roundIdx, roundIdx)))
    .limit(1);

  // Pool defaults to (0, 0) if case not yet spawned — still a valid quote at
  // the seed state so the UI can preview.
  const upShares = caseRow?.upSharesE8 ?? 0n;
  const downShares = caseRow?.downSharesE8 ?? 0n;
  const caseState = caseRow?.state;
  const resolvedOutcome = caseRow?.resolvedOutcome ?? null;

  const side = sideStr === "UP" || sideStr === "DOWN" ? sideStr : null;

  // ── Marginal up/down prices ───────────────────────────────────────
  // RESOLVED: lock to redemption ($1 winner / $0 loser) so the trade panel
  // matches what /api/sell will actually pay out. OPEN/CLOSED/VOID/missing
  // row: AMM curve marginal (frozen reserves for CLOSED/VOID).
  let upCents: number;
  let downCents: number;
  if (caseState === "RESOLVED" && resolvedOutcome) {
    upCents = resolvedOutcome === "UP" ? 100 : 0;
    downCents = resolvedOutcome === "DOWN" ? 100 : 0;
  } else {
    const prices = curvePrices(upShares, downShares);
    upCents = prices.upCents;
    downCents = prices.downCents;
  }

  // ── Buy quote ─────────────────────────────────────────────────────
  // Only meaningful in OPEN state; non-OPEN rounds reject buys server-side.
  let buyOut: QuoteResponse["buy"] = null;
  if (
    side &&
    amountCentsStr &&
    (caseState === "OPEN" || caseState === undefined)
  ) {
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

  // ── Sell quote ────────────────────────────────────────────────────
  // OPEN: pm-AMM curve.
  // RESOLVED: redemption price × shares ($1 winner / $0 loser).
  // CLOSED: settling — null preview (button is disabled until RESOLVED).
  // VOID: cost-basis pro-rata depends on user position; quote endpoint has no
  //       user context, so return null and let /api/sell compute the refund
  //       at execution time.
  let sellOut: QuoteResponse["sell"] = null;
  if (side && sharesE8Str) {
    const shares = BigInt(sharesE8Str);
    if (shares > 0n) {
      if (caseState === "RESOLVED" && resolvedOutcome) {
        const isWinner = side === resolvedOutcome;
        const pricePerShareCents = isWinner ? 100 : 0;
        sellOut = {
          proceedsCents: sharesE8ToCents(shares, pricePerShareCents).toString(),
          pricePerShareCents,
          upPriceCentsAfter: upCents,
          downPriceCentsAfter: downCents,
        };
      } else if (caseState === "OPEN" || caseState === undefined) {
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
      // CLOSED / VOID intentionally leave sellOut = null
    }
  }

  const response: QuoteResponse = {
    seriesId,
    roundIdx,
    upCents,
    downCents,
    buy: buyOut,
    sell: sellOut,
    ...(caseState ? { caseState } : {}),
    ...(caseState === "RESOLVED" ? { resolvedOutcome } : {}),
  };
  return NextResponse.json(response);
}
