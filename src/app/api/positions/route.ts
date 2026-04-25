import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { casesV3, positionsV3 } from "@/db/schema";
import { curvePrices } from "@/lib/quant";
import type { ApiErrorResponse, PositionsResponse } from "@/lib/types/v3-api";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// 设计原则：只有 BUY 和 SELL 两种操作，没有 "claim"。
// Resolve 不动 sharesE8，只锁定 redemption 价格：
//   RESOLVED 赢方 → SELL @ $1.00/share
//   RESOLVED 输方 → SELL @ $0.00/share（清账，无收益但允许）
//   VOID         → SELL @ cost-basis-pro-rata（refund at cost）
// 因此：任何 sharesE8 > 0 的行都应该可见，让用户能 SELL。
// "CLAIMABLE" status 字符串是历史命名，语义上 = "已 resolve 但仍持有筹码 → 可 sell"。
// ─────────────────────────────────────────────────────────────────────────────

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
  // to OPEN + CLAIMABLE (= still holding shares) for display below.
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
    const isVoid = r.caseState === "VOID";
    const stillHolding = r.sharesE8 > 0n;

    // Status =
    //   OPEN       = 还在交易中且持有筹码（可 BUY/SELL）
    //   CLAIMABLE  = 已 resolve 且仍持有筹码（可 SELL — 赢家@$1, 输家@$0, VOID@cost basis）
    //   CLAIMED    = 已 resolve 且筹码已 sell 干净（不返回）
    //   LOST       = 兜底（不返回）
    let status: "OPEN" | "CLAIMABLE" | "CLAIMED" | "LOST";
    if (isOpenCase && stillHolding) {
      status = "OPEN";
    } else if (isResolved && stillHolding) {
      status = "CLAIMABLE";
    } else if (isResolved && !stillHolding) {
      status = "CLAIMED"; // 包含 sell 完的赢家、输家、VOID 退完的
    } else {
      status = "LOST";
    }

    // Mark value = 用户此刻 sell 完所有 shares 能拿到的钱。
    let markValueCents: bigint | null = null;
    let unrealizedPnlCents: bigint | null = null;
    if (status === "OPEN" && r.upSharesE8 != null && r.downSharesE8 != null) {
      // 现行 pm-AMM curve marginal price（近似 — 真 sell quote 在 /api/quote）
      const prices = curvePrices(r.upSharesE8, r.downSharesE8);
      const sidePriceCents = r.side === "UP" ? prices.upCents : prices.downCents;
      markValueCents = (r.sharesE8 * BigInt(sidePriceCents)) / 100_000_000n;
      unrealizedPnlCents = markValueCents - r.costBasisCents;
      totalMark += markValueCents;
    } else if (status === "CLAIMABLE") {
      if (isVoid) {
        // VOID: refund 等于剩余 cost basis（pro-rata）
        markValueCents = r.costBasisCents;
      } else {
        // RESOLVED: 赢方 = shares × $1，输方 = $0
        const winning = r.resolvedOutcome === r.side;
        markValueCents = winning ? r.sharesE8 / 1_000_000n : 0n;
      }
      unrealizedPnlCents = markValueCents - r.costBasisCents;
      totalMark += markValueCents;
    }

    // Lifetime realized P&L includes positions whose redemption is locked
    // (sold or not) — outcome was decided at resolve time.
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
      // Sell value for CLAIMABLE rows. = exactly markValueCents (locked
      // redemption, no AMM slippage post-resolve). Field name is historical;
      // it's just "what user gets if they SELL all remaining shares now".
      claimableCents:
        status === "CLAIMABLE" ? markValueCents!.toString() : null,
    };
  });

  // 只返回还持有筹码的行（OPEN + CLAIMABLE）。已 sell 干净的 (CLAIMED/LOST)
  // 不返回 — totalRealized 已经累计过它们的历史 P&L。
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
