import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, positions, markets, claims } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getVerifiedAddress } from "@/lib/auth";
import { isValidAddress } from "@/lib/utils";
import type { UserPortfolio, PositionView } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Prefer session auth; fall back to query param for public profile viewing
    const sessionAddr = await getVerifiedAddress(request);
    const queryAddr = request.nextUrl.searchParams.get("address");
    const addr = sessionAddr ?? (queryAddr && isValidAddress(queryAddr) ? queryAddr.toLowerCase() : null);

    if (!addr) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const [user] = await db.select().from(users).where(eq(users.address, addr));

    if (!user) {
      return NextResponse.json({
        address: addr,
        balance: 0,
        faucetClaimedAt: null,
        positions: [],
      } satisfies UserPortfolio);
    }

    // Fetch positions with their market data in one query
    const posRows = await db
      .select({
        id: positions.id,
        marketId: positions.marketId,
        side: positions.side,
        amountSpent: positions.amountSpent,
        sharesReceived: positions.sharesReceived,
        avgPrice: positions.avgPrice,
        // Market fields — pre-computed, no calculation needed
        marketQuestion: markets.question,
        marketState: markets.state,
        marketYesPrice: markets.yesPrice,
        marketNoPrice: markets.noPrice,
        marketResolvedOutcome: markets.resolvedOutcome,
      })
      .from(positions)
      .innerJoin(markets, eq(positions.marketId, markets.id))
      .where(eq(positions.userAddress, addr));

    // Fetch claims for this user
    const userClaims = await db
      .select({ marketId: claims.marketId })
      .from(claims)
      .where(eq(claims.userAddress, addr));
    const claimedMarkets = new Set(userClaims.map((c) => c.marketId));

    const positionViews: PositionView[] = posRows.map((p) => {
      const currentPrice = Number(p.side === "YES" ? p.marketYesPrice : p.marketNoPrice);
      const shares = Number(p.sharesReceived);
      const spent = Number(p.amountSpent);
      const currentValue = shares * currentPrice;
      const pnl = currentValue - spent;

      const isResolved = p.marketState === "RESOLVED" || p.marketState === "SETTLED";
      const isWinner = isResolved && p.marketResolvedOutcome === p.side;
      const alreadyClaimed = claimedMarkets.has(p.marketId);

      return {
        id: p.id,
        marketId: p.marketId,
        marketQuestion: p.marketQuestion,
        marketState: p.marketState,
        side: p.side,
        amountSpent: spent,
        sharesReceived: shares,
        avgPrice: Number(p.avgPrice),
        currentPrice,
        currentValue,
        pnl,
        claimable: isWinner && !alreadyClaimed,
        claimableAmount: isWinner ? shares : 0,
        resolvedOutcome: p.marketResolvedOutcome,
        claimed: alreadyClaimed,
      };
    });

    return NextResponse.json({
      address: user.address,
      balance: Number(user.balance),
      faucetClaimedAt: user.faucetClaimedAt?.toISOString() ?? null,
      positions: positionViews,
    } satisfies UserPortfolio);
  } catch (error) {
    console.error("Portfolio error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
