import { NextRequest, NextResponse } from "next/server";
import {
  getMarketsList,
  parseMarketsSearchParams,
  scheduleActiveRecurringMarketsEnsure,
} from "@/lib/markets-query";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    scheduleActiveRecurringMarketsEnsure();
    const result = await getMarketsList(parseMarketsSearchParams(request.nextUrl.searchParams));
    return NextResponse.json(result);
  } catch (error) {
    console.error("Markets list error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
