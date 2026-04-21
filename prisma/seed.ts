/**
 * Seed: creates recurring quick-play BTC/ETH markets.
 * Round duration is sourced from RECURRING_DURATION_MINUTES in src/lib/constants.ts.
 * Usage: npx tsx prisma/seed.ts
 */

import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { markets } from "../src/db/schema";
import { calculatePrices } from "../src/lib/amm";
import { RECURRING_DURATION_MINUTES } from "../src/lib/constants";

const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
const isRemote = (connectionString ?? "").includes("vercel-storage.com") ||
  (connectionString ?? "").includes("neon.tech") ||
  (connectionString ?? "").includes("supabase.co");

async function main() {
  const pool = new pg.Pool({
    connectionString,
    ssl: isRemote ? { rejectUnauthorized: false } : undefined,
  });
  const db = drizzle(pool);
  const prices = calculatePrices(1, 1);

  console.log(`\nCreating recurring ${RECURRING_DURATION_MINUTES}-min markets...\n`);

  try {
    const cgRes = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd"
    );
    if (!cgRes.ok) throw new Error(`CoinGecko API error: ${cgRes.status}`);
    const cgData = await cgRes.json();

    const now = new Date();
    const closeTime = new Date(now.getTime() + RECURRING_DURATION_MINUTES * 60 * 1000);
    const timeStr = closeTime.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });

    const recurringMarkets = [
      { asset: "BTC", groupId: "btc-15m", price: cgData.bitcoin.usd, rounding: 500, name: "Bitcoin" },
      { asset: "ETH", groupId: "eth-15m", price: cgData.ethereum.usd, rounding: 25, name: "Ethereum" },
    ];

    for (const rm of recurringMarkets) {
      const strike = Math.round(rm.price / rm.rounding) * rm.rounding;
      const slug = `recurring-${rm.groupId}-${now.getTime()}`;

      await db.insert(markets).values({
        slug,
        question: `Will ${rm.name} be above $${strike.toLocaleString("en-US")} at ${timeStr} UTC?`,
        description: `Resolves YES if ${rm.name} price is at or above $${strike.toLocaleString("en-US")} at close time. Price sourced from CoinGecko.`,
        state: "OPEN",
        marketType: "RECURRING",
        asset: rm.asset,
        strikePrice: String(strike),
        recurringGroupId: rm.groupId,
        yesDemand: "1",
        noDemand: "1",
        yesPrice: String(prices.yesPrice),
        noPrice: String(prices.noPrice),
        totalVolume: "0",
        closeTime,
      });

      console.log(`  [RECURRING] ${rm.asset} — $${strike.toLocaleString("en-US")} at ${timeStr} UTC`);
    }
  } catch (err) {
    console.error("Recurring markets failed (CoinGecko may be unavailable):", err);
  }

  console.log("\nDone.");
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
