import { NextRequest, NextResponse } from "next/server";
import { desc, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { ordersV3, positionsV3 } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * v3 leaderboard — canonical realized PNL from positions_v3.
 *
 * profit_cents = SUM(realized_pnl_cents) per user (settled positions only)
 * trade_count  = total order count (buy + sell) per user, joined separately
 */
export async function GET(request: NextRequest) {
  try {
    const limit = Math.min(
      Math.max(
        parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50,
        1,
      ),
      100,
    );

    const profitExpr = sql<string>`SUM(${positionsV3.realizedPnlCents})`;

    // Realized PnL per user from positions_v3 (single source of truth).
    const profitRows = await db
      .select({
        userAddress: positionsV3.userAddress,
        profitCents: profitExpr.as("profit_cents"),
      })
      .from(positionsV3)
      .where(isNotNull(positionsV3.userAddress))
      .groupBy(positionsV3.userAddress)
      .orderBy(desc(profitExpr))
      .limit(limit);

    // Trade count from orders_v3 (buy + sell rows) — separate query so the
    // join doesn't double-count positions across sides.
    const tradeRows = await db
      .select({
        userAddress: ordersV3.userAddress,
        tradeCount: sql<number>`COUNT(*)::int`.as("trade_count"),
      })
      .from(ordersV3)
      .groupBy(ordersV3.userAddress);
    const tradesByUser = new Map(
      tradeRows.map((r) => [r.userAddress, Number(r.tradeCount ?? 0)]),
    );

    const entries = profitRows.map((r, i) => ({
      rank: i + 1,
      address: r.userAddress,
      profit: Number(r.profitCents ?? "0") / 100,
      tradeCount: tradesByUser.get(r.userAddress) ?? 0,
    }));

    return NextResponse.json(entries);
  } catch (error) {
    console.error("Leaderboard error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
