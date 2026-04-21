import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { markets, trades } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [market] = await db
      .select()
      .from(markets)
      .where(eq(markets.id, id));

    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    // Recent trades — uses index on (market_id, created_at)
    const recentTrades = await db
      .select({
        id: trades.id,
        side: trades.side,
        amountSpent: trades.amountSpent,
        sharesReceived: trades.sharesReceived,
        priceAtTrade: trades.priceAtTrade,
        createdAt: trades.createdAt,
        userAddress: trades.userAddress,
      })
      .from(trades)
      .where(eq(trades.marketId, id))
      .orderBy(desc(trades.createdAt))
      .limit(20);

    return NextResponse.json({
      id: market.id,
      question: market.question,
      description: market.description,
      imageUrl: market.imageUrl,
      state: market.state,
      yesPrice: Number(market.yesPrice),
      noPrice: Number(market.noPrice),
      yesDemand: Number(market.yesDemand),
      noDemand: Number(market.noDemand),
      closeTime: market.closeTime?.toISOString() ?? null,
      resolvedOutcome: market.resolvedOutcome,
      slug: market.slug,
      totalVolume: Number(market.totalVolume),
      marketType: market.marketType,
      asset: market.asset,
      strikePrice: market.strikePrice ? Number(market.strikePrice) : null,
      recurringGroupId: market.recurringGroupId,
      recentTrades: recentTrades.map((t) => ({
        ...t,
        amountSpent: Number(t.amountSpent),
        sharesReceived: Number(t.sharesReceived),
        priceAtTrade: Number(t.priceAtTrade),
      })),
    });
  } catch (error) {
    console.error("Market detail error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
