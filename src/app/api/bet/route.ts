import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { casesV3, ordersV3, positionsV3, userBalancesV3 } from "@/db/schema";
import { getVerifiedAddress } from "@/lib/auth";
import {
  computeCurrentRoundIdx,
  computeRoundClose,
  computeRoundStart,
  getSeries,
  isMarketOpen,
  resolveSeriesFeedId,
} from "@/lib/series-config";
import { getCachedPrice, pythE8ToCents } from "@/lib/pyth-hermes";
import { quoteBuy } from "@/lib/quant";
import type { ApiErrorResponse, BetResponse } from "@/lib/types/v3-api";

export const dynamic = "force-dynamic";

const MIN_BET_CENTS = 10; // $0.10
const MAX_BET_CENTS = 1_000_000; // $10k cap per bet
const CLOSE_GUARD_SEC = 5; // reject bets within 5s of close

function err(code: string, message: string, status = 400, detail?: unknown) {
  const body: ApiErrorResponse = { error: { code: code as never, message, detail: detail as never } };
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  const address = await getVerifiedAddress(request);
  if (!address) return err("UNAUTHORIZED", "Connect wallet and sign in first", 401);

  let body: {
    seriesId?: string;
    roundIdx?: number;
    side?: string;
    amountCents?: number;
    nonce?: string;
  };
  try {
    body = await request.json();
  } catch {
    return err("BAD_REQUEST", "Invalid JSON");
  }

  const { seriesId, roundIdx, side, amountCents, nonce } = body;
  if (!seriesId || typeof roundIdx !== "number" || !nonce) {
    return err("BAD_REQUEST", "seriesId, roundIdx, nonce required");
  }
  if (side !== "UP" && side !== "DOWN") {
    return err("BAD_REQUEST", "side must be UP or DOWN");
  }
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents)) {
    return err("BAD_REQUEST", "amountCents must be integer");
  }
  if (amountCents < MIN_BET_CENTS) {
    return err("BET_TOO_SMALL", `Minimum bet $${(MIN_BET_CENTS / 100).toFixed(2)}`);
  }
  if (amountCents > MAX_BET_CENTS) {
    return err("BET_TOO_LARGE", `Maximum bet $${(MAX_BET_CENTS / 100).toFixed(0)}`);
  }

  const series = getSeries(seriesId);
  if (!series) return err("SERIES_NOT_FOUND", `Unknown series ${seriesId}`, 404);

  const nowSec = Math.floor(Date.now() / 1000);
  const currentRoundIdx = computeCurrentRoundIdx(series, nowSec);
  if (roundIdx !== currentRoundIdx) {
    return err("ROUND_CLOSED", `Round ${roundIdx} is not current (current=${currentRoundIdx})`);
  }

  const hours = isMarketOpen(series, nowSec);
  if (!hours.open) {
    return err("MARKET_CLOSED", `Market closed (${hours.reason})`, 400, hours);
  }

  const amountBig = BigInt(amountCents);
  const placedAtSec = nowSec;
  const sideTyped = side as "UP" | "DOWN";

  const liveTick = await getCachedPrice(resolveSeriesFeedId(series)).catch(
    () => null,
  );
  const lazyStartTimeSec = computeRoundStart(series, roundIdx);
  const lazyCloseTimeSec = computeRoundClose(series, roundIdx);
  const lazyStrikePriceE8 = liveTick?.priceE8 ?? null;
  const lazyStrikeCents = liveTick
    ? pythE8ToCents(liveTick.priceE8, liveTick.expo)
    : null;

  try {
    const result = await db.transaction(
      async (tx) => {
        // 1. Ensure case row exists
        await tx
          .insert(casesV3)
          .values({
            seriesId,
            roundIdx,
            startTimeSec: lazyStartTimeSec,
            closeTimeSec: lazyCloseTimeSec,
            strikePriceE8: lazyStrikePriceE8,
            strikeCents: lazyStrikeCents,
            state: "OPEN",
          })
          .onConflictDoNothing();

        const [caseRow] = await tx
          .select()
          .from(casesV3)
          .where(
            and(eq(casesV3.seriesId, seriesId), eq(casesV3.roundIdx, roundIdx)),
          )
          .limit(1);
        if (!caseRow) {
          throw { _err: true, code: "ROUND_NOT_FOUND", message: "Round not yet spawned; try again in a moment" };
        }
        if (caseRow.state !== "OPEN") {
          throw { _err: true, code: "ROUND_CLOSED", message: "Round not open" };
        }
        if (Number(caseRow.closeTimeSec) - nowSec <= CLOSE_GUARD_SEC) {
          throw { _err: true, code: "ROUND_CLOSED", message: "Round closing too soon" };
        }

        // 2. Quote the trade against the current pool reserves
        const quote = quoteBuy(
          caseRow.upSharesE8,
          caseRow.downSharesE8,
          sideTyped,
          amountBig,
        );
        if (quote.sharesE8 <= 0n) {
          throw { _err: true, code: "QUOTE_FAILED", message: "AMM returned non-positive shares" };
        }

        // 3. Ensure user_balances row exists; check balance
        await tx
          .insert(userBalancesV3)
          .values({ address })
          .onConflictDoNothing();
        const [balanceRow] = await tx
          .select()
          .from(userBalancesV3)
          .where(eq(userBalancesV3.address, address))
          .limit(1);
        if (!balanceRow || balanceRow.availableCents < amountBig) {
          throw {
            _err: true,
            code: "INSUFFICIENT_BALANCE",
            message: `Need ${amountCents} cents, have ${(balanceRow?.availableCents ?? 0n).toString()}`,
          };
        }

        // 4. Debit balance (no separate "lockedCents" — open positions value is
        //    derived live from positions_v3 × current curve price)
        await tx
          .update(userBalancesV3)
          .set({
            availableCents: sql`${userBalancesV3.availableCents} - ${amountBig}`,
            updatedAt: new Date(),
          })
          .where(eq(userBalancesV3.address, address));

        // 5. Update case: reserves (pm-AMM curve) + legacy parimutuel pool
        const upPoolDelta = sideTyped === "UP" ? amountBig : 0n;
        const downPoolDelta = sideTyped === "DOWN" ? amountBig : 0n;
        await tx
          .update(casesV3)
          .set({
            upSharesE8: quote.newUpSharesE8,
            downSharesE8: quote.newDownSharesE8,
            upPoolCents: sql`${casesV3.upPoolCents} + ${upPoolDelta}`,
            downPoolCents: sql`${casesV3.downPoolCents} + ${downPoolDelta}`,
          })
          .where(
            and(eq(casesV3.seriesId, seriesId), eq(casesV3.roundIdx, roundIdx)),
          );

        // 6. Insert order (nonce uniqueness check via DB constraint)
        const [order] = await tx
          .insert(ordersV3)
          .values({
            userAddress: address,
            seriesId,
            roundIdx,
            side: sideTyped,
            amountCents: amountBig,
            sharesE8: quote.sharesE8,
            isBuy: 1,
            nonce,
            placedAtSec,
          })
          .returning();

        // 7. Upsert position: add shares + cost basis
        await tx
          .insert(positionsV3)
          .values({
            userAddress: address,
            seriesId,
            roundIdx,
            side: sideTyped,
            sharesE8: quote.sharesE8,
            costBasisCents: amountBig,
            realizedPnlCents: 0n,
          })
          .onConflictDoUpdate({
            target: [
              positionsV3.userAddress,
              positionsV3.seriesId,
              positionsV3.roundIdx,
              positionsV3.side,
            ],
            set: {
              sharesE8: sql`${positionsV3.sharesE8} + ${quote.sharesE8}`,
              costBasisCents: sql`${positionsV3.costBasisCents} + ${amountBig}`,
              updatedAt: new Date(),
            },
          });

        const [updatedBalance] = await tx
          .select({ availableCents: userBalancesV3.availableCents })
          .from(userBalancesV3)
          .where(eq(userBalancesV3.address, address))
          .limit(1);

        return {
          orderId: order.orderId,
          newAvailableCents: updatedBalance.availableCents.toString(),
          upPoolAfterCents:
            (caseRow.upPoolCents + upPoolDelta).toString(),
          downPoolAfterCents:
            (caseRow.downPoolCents + downPoolDelta).toString(),
          sharesE8: quote.sharesE8.toString(),
          avgPriceCents: quote.avgPriceCents,
          upPriceCentsAfter: quote.upPriceCentsAfter,
          downPriceCentsAfter: quote.downPriceCentsAfter,
          upSharesAfterE8: quote.newUpSharesE8.toString(),
          downSharesAfterE8: quote.newDownSharesE8.toString(),
        };
      },
      { isolationLevel: "serializable" },
    );

    const response: BetResponse = {
      orderId: result.orderId,
      acceptedAtSec: placedAtSec,
      newAvailableCents: result.newAvailableCents,
      upPoolAfterCents: result.upPoolAfterCents,
      downPoolAfterCents: result.downPoolAfterCents,
      sharesE8: result.sharesE8,
      avgPriceCents: result.avgPriceCents,
      upPriceCentsAfter: result.upPriceCentsAfter,
      downPriceCentsAfter: result.downPriceCentsAfter,
      upSharesAfterE8: result.upSharesAfterE8,
      downSharesAfterE8: result.downSharesAfterE8,
    };
    return NextResponse.json(response);
  } catch (e) {
    const asErr = e as { _err?: boolean; code?: string; message?: string };
    if (asErr?._err) {
      return err(
        asErr.code ?? "INTERNAL",
        asErr.message ?? "Bet failed",
        asErr.code === "INSUFFICIENT_BALANCE" ? 400 : 400,
      );
    }
    const message = (e as Error).message ?? "Unknown error";
    if (message.includes("orders_v3_nonce_uniq")) {
      return err("DUPLICATE_NONCE", "Nonce already used");
    }
    console.error("bet error:", e);
    return err("INTERNAL", "Bet failed internally", 500);
  }
}
