import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { inArray, eq, and, lt } from "drizzle-orm";
import { CRON_SECRET, RECURRING_DURATION_MINUTES } from "@/lib/constants";
import {
  fetchCryptoPrices,
  roundStrikePrice,
  generateMarketQuestion,
} from "@/lib/price-oracle";
import { calculatePrices } from "@/lib/amm";

const RECURRING_GROUPS: { groupId: string; asset: "BTC" | "ETH" }[] = [
  { groupId: "btc-15m", asset: "BTC" },
  { groupId: "eth-15m", asset: "ETH" },
];

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    let recurringResolved = 0, recurringCreated = 0;

    // Fetch crypto prices ONCE per cron tick. Both phases share the same snapshot.
    // Previously this called the external oracle twice per tick (expensive + rate-limit risk).
    let prices: { btc: number; eth: number } | null = null;
    try {
      prices = await fetchCryptoPrices();
    } catch { /* CoinGecko failed — phases will no-op below */ }

    // ─── Phase 1: Resolve expired recurring markets ───
    const expiredRecurring = await db
      .select()
      .from(markets)
      .where(
        and(
          eq(markets.marketType, "RECURRING"),
          inArray(markets.state, ["OPEN", "CLOSED"]),
          lt(markets.closeTime, now)
        )
      );

    if (expiredRecurring.length > 0 && prices) {
      for (const market of expiredRecurring) {
        try {
          const strike = Number(market.strikePrice);
          const currentPrice = market.asset === "BTC" ? prices.btc : prices.eth;
          const outcome = currentPrice >= strike ? "YES" : "NO";
          await db
            .update(markets)
            .set({
              state: "RESOLVED",
              resolvedOutcome: outcome,
              resolvedAt: now,
              yesPrice: outcome === "YES" ? "0.999" : "0.001",
              noPrice: outcome === "YES" ? "0.001" : "0.999",
            })
            .where(eq(markets.id, market.id));
          recurringResolved++;
        } catch { /* skip */ }
      }
    }

    // ─── Phase 2: Create new recurring markets if needed ───
    if (prices) {
      for (const { groupId, asset } of RECURRING_GROUPS) {
        const openInGroup = await db
          .select({ id: markets.id })
          .from(markets)
          .where(and(eq(markets.recurringGroupId, groupId), eq(markets.state, "OPEN")));

        if (openInGroup.length === 0) {
          const currentPrice = asset === "BTC" ? prices.btc : prices.eth;
          const strike = roundStrikePrice(currentPrice, asset);
          const closeTime = new Date(now.getTime() + RECURRING_DURATION_MINUTES * 60 * 1000);
          const question = generateMarketQuestion(asset, strike, closeTime);
          const initialPrices = calculatePrices(1, 1);

          await db.insert(markets).values({
            slug: `recurring-${groupId}-${now.getTime()}`,
            question,
            description: `Resolves YES if ${asset === "BTC" ? "Bitcoin" : "Ethereum"} price is at or above $${strike.toLocaleString("en-US")} at close time. Price sourced from CoinGecko.`,
            state: "OPEN",
            marketType: "RECURRING",
            asset,
            strikePrice: String(strike),
            recurringGroupId: groupId,
            yesDemand: "1",
            noDemand: "1",
            yesPrice: String(initialPrices.yesPrice),
            noPrice: String(initialPrices.noPrice),
            totalVolume: "0",
            closeTime,
          });
          recurringCreated++;
        }
      }
    }

    return NextResponse.json({
      recurring: { resolved: recurringResolved, created: recurringCreated },
    });
  } catch (error) {
    console.error("Cron resolve error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
