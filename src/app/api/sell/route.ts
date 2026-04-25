import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { casesV3, ordersV3, positionsV3, userBalancesV3 } from "@/db/schema";
import { getVerifiedAddress } from "@/lib/auth";
import { getSeries } from "@/lib/series-config";
import { quoteSell, sharesE8ToCents } from "@/lib/quant";
import type { ApiErrorResponse, SellResponse } from "@/lib/types/v3-api";

export const dynamic = "force-dynamic";

const MIN_SHARES_E8 = 1n;
const CLOSE_GUARD_SEC = 5;

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
    sharesE8?: string;
    nonce?: string;
  };
  try {
    body = await request.json();
  } catch {
    return err("BAD_REQUEST", "Invalid JSON");
  }

  const { seriesId, roundIdx, side, sharesE8, nonce } = body;
  if (!seriesId || typeof roundIdx !== "number" || !nonce || !sharesE8) {
    return err("BAD_REQUEST", "seriesId, roundIdx, nonce, sharesE8 required");
  }
  if (side !== "UP" && side !== "DOWN") {
    return err("BAD_REQUEST", "side must be UP or DOWN");
  }
  let sharesBig: bigint;
  try {
    sharesBig = BigInt(sharesE8);
  } catch {
    return err("BAD_REQUEST", "sharesE8 must be stringified bigint");
  }
  if (sharesBig < MIN_SHARES_E8) {
    return err("SELL_TOO_SMALL", "sharesE8 must be positive");
  }

  const series = getSeries(seriesId);
  if (!series) return err("SERIES_NOT_FOUND", `Unknown series ${seriesId}`, 404);

  const nowSec = Math.floor(Date.now() / 1000);
  const sideTyped = side as "UP" | "DOWN";
  const placedAtSec = nowSec;

  try {
    const result = await db.transaction(
      async (tx) => {
        // 1. Load case
        const [caseRow] = await tx
          .select()
          .from(casesV3)
          .where(
            and(eq(casesV3.seriesId, seriesId), eq(casesV3.roundIdx, roundIdx)),
          )
          .limit(1);
        if (!caseRow) {
          throw { _err: true, code: "ROUND_NOT_FOUND", message: "Round does not exist" };
        }

        // Reject CLOSED (transient pre-resolve) — selling allowed only when
        // OPEN (live curve) or RESOLVED/VOID (fixed redemption).
        if (caseRow.state === "CLOSED") {
          throw { _err: true, code: "ROUND_CLOSED", message: "Round is settling — try again in a moment" };
        }

        // OPEN: pm-AMM curve close-guard
        if (caseRow.state === "OPEN" && Number(caseRow.closeTimeSec) - nowSec <= CLOSE_GUARD_SEC) {
          throw { _err: true, code: "ROUND_CLOSED", message: "Round closing too soon" };
        }

        // 2. Verify user has sufficient shares
        const [position] = await tx
          .select()
          .from(positionsV3)
          .where(
            and(
              eq(positionsV3.userAddress, address),
              eq(positionsV3.seriesId, seriesId),
              eq(positionsV3.roundIdx, roundIdx),
              eq(positionsV3.side, sideTyped),
            ),
          )
          .limit(1);
        if (!position || position.sharesE8 < sharesBig) {
          throw {
            _err: true,
            code: "INSUFFICIENT_SHARES",
            message: `Need ${sharesBig.toString()} shares, have ${(position?.sharesE8 ?? 0n).toString()}`,
          };
        }

        // 3. Compute proceeds + new pool state per case state
        let proceedsCents: bigint;
        let pricePerShareCents: number;
        let newUpSharesE8 = caseRow.upSharesE8;
        let newDownSharesE8 = caseRow.downSharesE8;
        let upPriceCentsAfter = 0;
        let downPriceCentsAfter = 0;

        if (caseRow.state === "OPEN") {
          // Live pm-AMM curve
          const quote = quoteSell(
            caseRow.upSharesE8,
            caseRow.downSharesE8,
            sideTyped,
            sharesBig,
          );
          if (quote.proceedsCents < 0n) {
            throw { _err: true, code: "QUOTE_FAILED", message: "AMM returned negative proceeds" };
          }
          proceedsCents = quote.proceedsCents;
          pricePerShareCents = quote.pricePerShareCents;
          newUpSharesE8 = quote.newUpSharesE8;
          newDownSharesE8 = quote.newDownSharesE8;
          upPriceCentsAfter = quote.upPriceCentsAfter;
          downPriceCentsAfter = quote.downPriceCentsAfter;
        } else if (caseRow.state === "RESOLVED" || caseRow.state === "VOID") {
          // Fixed redemption price:
          //   RESOLVED: side === outcome → 100¢, else 0¢
          //   VOID (INVALID): refund cost basis pro-rata (any side, any shares)
          if (caseRow.state === "VOID") {
            // refund pro-rata cost basis
            proceedsCents =
              (position.costBasisCents * sharesBig) / position.sharesE8;
            pricePerShareCents = Number(
              (proceedsCents * 100n) / sharesBig,
            );
          } else {
            const winning = caseRow.resolvedOutcome === sideTyped;
            pricePerShareCents = winning ? 100 : 0;
            proceedsCents = sharesE8ToCents(sharesBig, pricePerShareCents);
          }
          // Post-resolve: curve is frozen; final marginal price = redemption.
          upPriceCentsAfter =
            caseRow.resolvedOutcome === "UP"
              ? 100
              : caseRow.resolvedOutcome === "DOWN"
                ? 0
                : 50;
          downPriceCentsAfter = 100 - upPriceCentsAfter;
        } else {
          throw { _err: true, code: "ROUND_CLOSED", message: "Round not in a sellable state" };
        }

        // 4. Cost basis pro-rata + realized P&L
        const costBasisReleased =
          (position.costBasisCents * sharesBig) / position.sharesE8;
        let realizedDelta = proceedsCents - costBasisReleased;

        // RESOLVED 输方的 loss 已经在 cron tick resolve 时 booked 进
        // realized_pnl_cents（commit 9c58deb）。sell-time 不再追加，避免
        // double-count。VOID 不走这个分支（cron 不 book，sell delta=0 自然对）。
        // RESOLVED 赢方 cron 也不 book wins，sell-time delta 是真利润，正常累加。
        if (caseRow.state === "RESOLVED") {
          const winning = caseRow.resolvedOutcome === sideTyped;
          if (!winning) realizedDelta = 0n;
        }

        // 5. Update case (only OPEN affects reserves; resolved is frozen)
        if (caseRow.state === "OPEN") {
          const upPoolDelta = sideTyped === "UP" ? -proceedsCents : 0n;
          const downPoolDelta = sideTyped === "DOWN" ? -proceedsCents : 0n;
          await tx
            .update(casesV3)
            .set({
              upSharesE8: newUpSharesE8,
              downSharesE8: newDownSharesE8,
              upPoolCents: sql`GREATEST(${casesV3.upPoolCents} + ${upPoolDelta}, 0)`,
              downPoolCents: sql`GREATEST(${casesV3.downPoolCents} + ${downPoolDelta}, 0)`,
            })
            .where(
              and(eq(casesV3.seriesId, seriesId), eq(casesV3.roundIdx, roundIdx)),
            );
        }

        // 6. Update position
        const newShares = position.sharesE8 - sharesBig;
        const newCostBasis = position.costBasisCents - costBasisReleased;
        await tx
          .update(positionsV3)
          .set({
            sharesE8: newShares,
            costBasisCents: newCostBasis,
            realizedPnlCents: sql`${positionsV3.realizedPnlCents} + ${realizedDelta}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(positionsV3.userAddress, address),
              eq(positionsV3.seriesId, seriesId),
              eq(positionsV3.roundIdx, roundIdx),
              eq(positionsV3.side, sideTyped),
            ),
          );

        // 7. Insert sell order row
        const [order] = await tx
          .insert(ordersV3)
          .values({
            userAddress: address,
            seriesId,
            roundIdx,
            side: sideTyped,
            amountCents: proceedsCents,
            sharesE8: sharesBig,
            isBuy: 0,
            nonce,
            placedAtSec,
            payoutCents: proceedsCents,
          })
          .returning();

        // 8. Credit balance
        await tx
          .insert(userBalancesV3)
          .values({ address })
          .onConflictDoNothing();
        await tx
          .update(userBalancesV3)
          .set({
            availableCents: sql`${userBalancesV3.availableCents} + ${proceedsCents}`,
            updatedAt: new Date(),
          })
          .where(eq(userBalancesV3.address, address));

        const [updatedBalance] = await tx
          .select({ availableCents: userBalancesV3.availableCents })
          .from(userBalancesV3)
          .where(eq(userBalancesV3.address, address))
          .limit(1);

        const [updatedPosition] = await tx
          .select({ realizedPnlCents: positionsV3.realizedPnlCents })
          .from(positionsV3)
          .where(
            and(
              eq(positionsV3.userAddress, address),
              eq(positionsV3.seriesId, seriesId),
              eq(positionsV3.roundIdx, roundIdx),
              eq(positionsV3.side, sideTyped),
            ),
          )
          .limit(1);

        return {
          orderId: order.orderId,
          newAvailableCents: updatedBalance.availableCents.toString(),
          proceedsCents: proceedsCents.toString(),
          pricePerShareCents,
          upPriceCentsAfter,
          downPriceCentsAfter,
          upSharesAfterE8: newUpSharesE8.toString(),
          downSharesAfterE8: newDownSharesE8.toString(),
          remainingSharesE8: newShares.toString(),
          realizedPnlCents: updatedPosition.realizedPnlCents.toString(),
        };
      },
      { isolationLevel: "serializable" },
    );

    const response: SellResponse = {
      orderId: result.orderId,
      acceptedAtSec: placedAtSec,
      newAvailableCents: result.newAvailableCents,
      proceedsCents: result.proceedsCents,
      pricePerShareCents: result.pricePerShareCents,
      upPriceCentsAfter: result.upPriceCentsAfter,
      downPriceCentsAfter: result.downPriceCentsAfter,
      upSharesAfterE8: result.upSharesAfterE8,
      downSharesAfterE8: result.downSharesAfterE8,
      remainingSharesE8: result.remainingSharesE8,
      realizedPnlCents: result.realizedPnlCents,
    };
    return NextResponse.json(response);
  } catch (e) {
    const asErr = e as { _err?: boolean; code?: string; message?: string };
    if (asErr?._err) {
      return err(asErr.code ?? "INTERNAL", asErr.message ?? "Sell failed", 400);
    }
    const message = (e as Error).message ?? "Unknown error";
    if (message.includes("orders_v3_nonce_uniq")) {
      return err("DUPLICATE_NONCE", "Nonce already used");
    }
    console.error("sell error:", e);
    return err("INTERNAL", "Sell failed internally", 500);
  }
}
