import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/db";
import { calculateTradeQuote, calculateSellQuote } from "@/lib/amm";
import { requireAuth } from "@/lib/auth";
import type { TradeResult } from "@/types";

/**
 * Trade route uses a raw SQL transaction for atomicity and speed.
 * All reads + writes happen in a single PostgreSQL transaction.
 * This avoids Drizzle's ORM overhead on the hottest path.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify wallet session
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const addr = auth.address;

    const { side, amount, direction = "BUY" } = await request.json();

    if (side !== "YES" && side !== "NO") {
      return NextResponse.json({ error: "Side must be YES or NO" }, { status: 400 });
    }
    if (direction !== "BUY" && direction !== "SELL") {
      return NextResponse.json({ error: "Direction must be BUY or SELL" }, { status: 400 });
    }
    if (typeof amount !== "number" || amount <= 0) {
      return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
    }
    const isSell = direction === "SELL";
    const { id: marketId } = await params;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // 1. Lock and read market
      const { rows: [market] } = await client.query(
        `SELECT id, state, yes_demand, no_demand, close_time, total_volume
         FROM markets WHERE id = $1 FOR UPDATE`,
        [marketId]
      );
      if (!market) throw new Error("Market not found");
      if (market.state !== "OPEN") throw new Error("Market is not open for trading");
      if (market.close_time && new Date() > new Date(market.close_time)) {
        // Auto-close expired market in the same transaction
        await client.query(
          `UPDATE markets SET state = 'CLOSED', updated_at = NOW() WHERE id = $1`,
          [marketId]
        );
        throw new Error("Market has expired");
      }

      // 2. Lock and read user
      const { rows: [user] } = await client.query(
        `SELECT address, balance FROM users WHERE address = $1 FOR UPDATE`,
        [addr]
      );
      if (!user) throw new Error("User not found. Claim faucet first.");

      const tradeId = crypto.randomUUID();

      if (isSell) {
        // ─── SELL FLOW ───────────────────────────────────────
        // amount = number of shares to sell

        // 2b. Lock and read position
        const { rows: [position] } = await client.query(
          `SELECT shares_received, amount_spent FROM positions
           WHERE user_address = $1 AND market_id = $2 AND side = $3 FOR UPDATE`,
          [addr, marketId, side]
        );
        if (!position) throw new Error("No position to sell");
        const currentShares = Number(position.shares_received);
        if (amount > currentShares) throw new Error("Cannot sell more shares than you own");

        // 3. Calculate sell quote
        const sellQuote = calculateSellQuote(
          Number(market.yes_demand),
          Number(market.no_demand),
          side,
          amount
        );

        // 4. Credit balance with proceeds
        await client.query(
          `UPDATE users SET balance = balance + $1 WHERE address = $2`,
          [sellQuote.proceeds, addr]
        );

        // 5. Update market demand + prices + volume
        await client.query(
          `UPDATE markets
           SET yes_demand = $1, no_demand = $2,
               yes_price = $3, no_price = $4,
               total_volume = total_volume + $5,
               updated_at = NOW()
           WHERE id = $6`,
          [
            sellQuote.newYesDemand, sellQuote.newNoDemand,
            sellQuote.newYesPrice, sellQuote.newNoPrice,
            sellQuote.proceeds, marketId,
          ]
        );

        // 6. Insert trade record (negative amount_spent = sell)
        await client.query(
          `INSERT INTO trades (id, user_address, market_id, side, amount_spent, shares_received, price_at_trade)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [tradeId, addr, marketId, side, -sellQuote.proceeds, -amount, sellQuote.pricePerShare]
        );

        // 7. Update or delete position
        const remainingShares = currentShares - amount;
        if (remainingShares <= 0.000001) {
          await client.query(
            `DELETE FROM positions WHERE user_address = $1 AND market_id = $2 AND side = $3`,
            [addr, marketId, side]
          );
        } else {
          const remainingSpent = Number(position.amount_spent) * (remainingShares / currentShares);
          await client.query(
            `UPDATE positions
             SET shares_received = $1, amount_spent = $2,
                 avg_price = $3, updated_at = NOW()
             WHERE user_address = $4 AND market_id = $5 AND side = $6`,
            [remainingShares, remainingSpent, remainingSpent / remainingShares, addr, marketId, side]
          );
        }

        // 8. Read new balance
        const { rows: [updated] } = await client.query(
          `SELECT balance FROM users WHERE address = $1`, [addr]
        );

        await client.query("COMMIT");

        return NextResponse.json({
          tradeId, side, direction: "SELL",
          amountSpent: -sellQuote.proceeds,
          sharesReceived: -amount,
          priceAtTrade: sellQuote.pricePerShare,
          newYesPrice: sellQuote.newYesPrice,
          newNoPrice: sellQuote.newNoPrice,
          newBalance: Number(updated.balance),
        } satisfies TradeResult & { direction: string });

      } else {
        // ─── BUY FLOW (existing) ─────────────────────────────
        if (Number(user.balance) < amount) throw new Error("Insufficient balance");

        // 3. Calculate trade
        const quote = calculateTradeQuote(
          Number(market.yes_demand), Number(market.no_demand), side, amount
        );

        // 4. Deduct balance
        await client.query(
          `UPDATE users SET balance = balance - $1 WHERE address = $2`,
          [amount, addr]
        );

        // 5. Update market demand + pre-computed prices + volume
        await client.query(
          `UPDATE markets
           SET yes_demand = $1, no_demand = $2,
               yes_price = $3, no_price = $4,
               total_volume = total_volume + $5,
               updated_at = NOW()
           WHERE id = $6`,
          [quote.newYesDemand, quote.newNoDemand, quote.newYesPrice, quote.newNoPrice, amount, marketId]
        );

        // 6. Insert trade
        await client.query(
          `INSERT INTO trades (id, user_address, market_id, side, amount_spent, shares_received, price_at_trade)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [tradeId, addr, marketId, side, amount, quote.sharesReceived, quote.price]
        );

        // 7. Upsert position
        await client.query(
          `INSERT INTO positions (id, user_address, market_id, side, amount_spent, shares_received, avg_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_address, market_id, side)
           DO UPDATE SET
             amount_spent = positions.amount_spent + EXCLUDED.amount_spent,
             shares_received = positions.shares_received + EXCLUDED.shares_received,
             avg_price = (positions.amount_spent + EXCLUDED.amount_spent) / (positions.shares_received + EXCLUDED.shares_received),
             updated_at = NOW()`,
          [crypto.randomUUID(), addr, marketId, side, amount, quote.sharesReceived, quote.price]
        );

        // 8. Read new balance
        const { rows: [updated] } = await client.query(
          `SELECT balance FROM users WHERE address = $1`, [addr]
        );

        await client.query("COMMIT");

        return NextResponse.json({
          tradeId, side,
          amountSpent: amount,
          sharesReceived: quote.sharesReceived,
          priceAtTrade: quote.price,
          newYesPrice: quote.newYesPrice,
          newNoPrice: quote.newNoPrice,
          newBalance: Number(updated.balance),
        } satisfies TradeResult);
      }
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trade failed";
    console.error("Trade error:", message);
    const status = message.includes("not found") || message.includes("No position") ? 404
      : message.includes("not open") || message.includes("expired") ? 403
      : message.includes("Insufficient") || message.includes("faucet") || message.includes("Cannot sell") ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
