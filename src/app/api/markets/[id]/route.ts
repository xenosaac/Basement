import { NextRequest, NextResponse } from "next/server";
import { getMarketById } from "@/lib/markets-query";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const market = await getMarketById(id);
    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }
    return NextResponse.json(market);
  } catch (error) {
    console.error("Market detail error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
