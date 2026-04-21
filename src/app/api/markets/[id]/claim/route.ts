import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/db";
import { requireAuth } from "@/lib/auth";
import type { ClaimResult } from "@/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify wallet session
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const addr = auth.address;
    const { id: marketId } = await params;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // 1. Check market is resolved
      const { rows: [market] } = await client.query(
        `SELECT state, resolved_outcome FROM markets WHERE id = $1`,
        [marketId]
      );
      if (!market) throw new Error("Market not found");
      if (market.state !== "RESOLVED" && market.state !== "SETTLED") {
        throw new Error("Market is not yet resolved");
      }

      // 2. Check no existing claim
      const { rows: existingClaims } = await client.query(
        `SELECT id FROM claims WHERE user_address = $1 AND market_id = $2`,
        [addr, marketId]
      );
      if (existingClaims.length > 0) throw new Error("Already claimed");

      // 3. Sum winning shares
      const { rows: [winRow] } = await client.query(
        `SELECT COALESCE(SUM(shares_received::numeric), 0) as total_shares
         FROM positions
         WHERE user_address = $1 AND market_id = $2 AND side = $3`,
        [addr, marketId, market.resolved_outcome]
      );
      const payout = Number(winRow.total_shares);
      if (payout <= 0) throw new Error("No winning position to claim");

      // 4. Create claim + credit balance
      const claimId = crypto.randomUUID();
      await client.query(
        `INSERT INTO claims (id, user_address, market_id, payout) VALUES ($1, $2, $3, $4)`,
        [claimId, addr, marketId, payout]
      );
      const { rows: [updated] } = await client.query(
        `UPDATE users SET balance = balance + $1 WHERE address = $2 RETURNING balance`,
        [payout, addr]
      );

      await client.query("COMMIT");

      // Auto-settle: if all winning positions have been claimed, mark market SETTLED
      try {
        const { rows: [{ count }] } = await pool.query(
          `SELECT COUNT(*) FROM positions p
           WHERE p.market_id = $1 AND p.side = $2
           AND NOT EXISTS (
             SELECT 1 FROM claims c
             WHERE c.user_address = p.user_address AND c.market_id = p.market_id
           )`,
          [marketId, market.resolved_outcome]
        );
        if (parseInt(count) === 0) {
          await pool.query(
            `UPDATE markets SET state = 'SETTLED', updated_at = NOW() WHERE id = $1`,
            [marketId]
          );
        }
      } catch { /* non-critical, don't fail the claim */ }

      return NextResponse.json({
        claimId,
        payout,
        newBalance: Number(updated.balance),
      } satisfies ClaimResult);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Claim failed";
    console.error("Claim error:", message);
    const status = message.includes("not found") ? 404
      : message.includes("Already") ? 409
      : message.includes("not yet") || message.includes("No winning") ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
