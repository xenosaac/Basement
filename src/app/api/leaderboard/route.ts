import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitParam ?? "20", 10) || 20, 1), 100);

    // Net worth = balance + unrealized position value (shares * current price)
    // Profit = net_worth - 1000 (initial faucet amount)
    const { rows } = await pool.query(
      `WITH user_positions_value AS (
         SELECT p.user_address,
                SUM(p.shares_received::float *
                    CASE WHEN p.side = 'YES' THEN m.yes_price::float
                         ELSE m.no_price::float END
                ) AS position_value
         FROM positions p
         JOIN markets m ON p.market_id = m.id
         GROUP BY p.user_address
       ),
       user_trades AS (
         SELECT user_address, COUNT(*)::int AS trade_count
         FROM trades
         GROUP BY user_address
       )
       SELECT
         u.address,
         u.balance::float + COALESCE(pv.position_value, 0) AS net_worth,
         u.balance::float + COALESCE(pv.position_value, 0) - 1000 AS profit,
         COALESCE(ut.trade_count, 0) AS trade_count
       FROM users u
       LEFT JOIN user_positions_value pv ON u.address = pv.user_address
       LEFT JOIN user_trades ut ON u.address = ut.user_address
       WHERE COALESCE(ut.trade_count, 0) > 0
       ORDER BY net_worth DESC
       LIMIT $1`,
      [limit]
    );

    const leaderboard = rows.map((row, i) => ({
      rank: i + 1,
      address: row.address,
      netWorth: Number(row.net_worth),
      profit: Number(row.profit),
      tradeCount: row.trade_count,
    }));

    return NextResponse.json(leaderboard);
  } catch (error) {
    console.error("Leaderboard error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
