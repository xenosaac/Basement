import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { eq } from "drizzle-orm";

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
    });
  } catch (error) {
    console.error("Market detail error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
