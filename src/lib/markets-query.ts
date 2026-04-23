import { and, asc, count, desc, eq, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { calculatePrices } from "@/lib/amm";
import { fetchPythPrice } from "@/lib/aptos";
import {
  activePythGroups,
  pythFeedForGroup,
  type MarketGroupSpec,
} from "@/lib/market-groups";
import type { MarketsResponse } from "@/types";

const VALID_STATES: readonly string[] = ["OPEN", "CLOSED", "RESOLVED", "SETTLED"];
// Registry-driven. Every active `pyth` group in market-groups.ts is covered
// here; adding a new recurring market (e.g. sol-3m, xau-1h) only requires a
// registry entry. Previously hardcoded to BTC+ETH with per-asset branches.
const RECURRING_SPECS: readonly MarketGroupSpec[] = activePythGroups();
// Fallback display prices when Pyth Hermes is unreachable. Used purely for
// the DB row's strike_price column; the ON-CHAIN strike is set from Hermes
// via the spawn-recurring cron and is independent of these values.
const FALLBACK_PRICES: Record<string, number> = {
  BTC: 85_000,
  ETH: 2_000,
  XAU: 4_700,
};
const DEFAULT_FALLBACK_PRICE = 100;
const RECURRING_ENSURE_COOLDOWN_MS = 30_000;

function humanAssetName(symbol: string): string {
  if (symbol === "BTC") return "Bitcoin";
  if (symbol === "ETH") return "Ethereum";
  if (symbol === "XAU") return "Gold";
  return symbol;
}

let lastRecurringEnsureStartedAt = 0;
let recurringEnsureInFlight: Promise<void> | null = null;

export interface MarketsQueryParams {
  state?: string | null;
  sort?: string | null;
  type?: string | null;
  limit?: number | string | null;
  offset?: number | string | null;
}

function clampInt(value: number | string | null | undefined, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : parseInt(value ?? String(fallback), 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, min), max);
}

export function parseMarketsSearchParams(searchParams: URLSearchParams): MarketsQueryParams {
  return {
    state: searchParams.get("state"),
    sort: searchParams.get("sort"),
    type: searchParams.get("type"),
    limit: searchParams.get("limit"),
    offset: searchParams.get("offset"),
  };
}

async function ensureActiveRecurringMarkets(): Promise<void> {
  const now = new Date();

  await Promise.all(
    RECURRING_SPECS.map(async (spec) => {
      const { groupId, assetSymbol, durationSec, questionTemplate } = spec;
      try {
        await db
          .update(markets)
          .set({ state: "CLOSED" })
          .where(
            and(
              eq(markets.recurringGroupId, groupId),
              eq(markets.state, "OPEN"),
              lt(markets.closeTime, now)
            )
          );

        const openInGroup = await db
          .select({ id: markets.id })
          .from(markets)
          .where(and(eq(markets.recurringGroupId, groupId), eq(markets.state, "OPEN")))
          .limit(1);

        if (openInGroup.length > 0) return;

        // Pull the current price from Pyth Hermes via the group's configured
        // feed id. Same source (beta on testnet / stable on mainnet) that
        // the on-chain spawn uses for MarketConfig.strike_price, so the DB
        // strike matches the chain within one refresh interval.
        let displayPrice: number;
        try {
          const feedId = pythFeedForGroup(spec);
          const { price, expo } = await fetchPythPrice(feedId);
          // Pyth returns price scaled by its per-feed exponent — typically
          // -8 for crypto, -3 for XAU. Apply the real expo to get the
          // human-readable decimal. On-chain still uses the raw integer.
          displayPrice = Number(price) * 10 ** expo;
        } catch {
          displayPrice = FALLBACK_PRICES[assetSymbol] ?? DEFAULT_FALLBACK_PRICE;
        }

        const closeTime = new Date(now.getTime() + durationSec * 1000);
        const initialPrices = calculatePrices(1, 1);
        const assetName = humanAssetName(assetSymbol);

        await db.insert(markets).values({
          slug: `recurring-${groupId}-${now.getTime()}`,
          question: questionTemplate,
          description: `Resolves YES if ${assetName} price at close is higher than at open. Price sourced from Pyth.`,
          state: "OPEN",
          marketType: "RECURRING",
          asset: assetSymbol,
          strikePrice: String(displayPrice),
          recurringGroupId: groupId,
          yesDemand: "1",
          noDemand: "1",
          yesPrice: String(initialPrices.yesPrice),
          noPrice: String(initialPrices.noPrice),
          totalVolume: "0",
          closeTime,
        });
      } catch (err) {
        console.error(`[auto-refresh] Failed to refresh ${groupId}:`, err);
      }
    })
  );
}

export function scheduleActiveRecurringMarketsEnsure() {
  const now = Date.now();
  if (
    recurringEnsureInFlight ||
    now - lastRecurringEnsureStartedAt < RECURRING_ENSURE_COOLDOWN_MS
  ) {
    return;
  }

  lastRecurringEnsureStartedAt = now;
  recurringEnsureInFlight = ensureActiveRecurringMarkets()
    .catch((err) => {
      console.error("[auto-refresh] Background recurring refresh failed:", err);
    })
    .finally(() => {
      recurringEnsureInFlight = null;
    });
}

export async function getMarketsList(params: MarketsQueryParams = {}): Promise<MarketsResponse> {
  const stateParam = params.state?.toUpperCase();
  const sortParam = params.sort ?? "newest";
  const typeParam = params.type?.toUpperCase();
  const limitParam = clampInt(params.limit, 50, 1, 100);
  const offsetParam = Math.max(clampInt(params.offset, 0, 0, Number.MAX_SAFE_INTEGER), 0);

  const conditions: SQL[] = [];
  if (stateParam && stateParam !== "ALL" && VALID_STATES.includes(stateParam)) {
    conditions.push(eq(markets.state, stateParam as "OPEN" | "CLOSED" | "RESOLVED" | "SETTLED"));
  }
  if (typeParam === "MIRRORED" || typeParam === "RECURRING") {
    conditions.push(eq(markets.marketType, typeParam));
  }

  const where =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
      ? conditions[0]
      : and(...conditions);

  let orderBy;
  switch (sortParam) {
    case "volume":
      orderBy = desc(markets.totalVolume);
      break;
    case "ending_soon":
      orderBy = asc(sql`COALESCE(${markets.closeTime}, '9999-12-31'::timestamp)`);
      break;
    default:
      orderBy = desc(markets.createdAt);
  }

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: markets.id,
        question: markets.question,
        description: markets.description,
        imageUrl: markets.imageUrl,
        state: markets.state,
        yesPrice: markets.yesPrice,
        noPrice: markets.noPrice,
        yesDemand: markets.yesDemand,
        noDemand: markets.noDemand,
        closeTime: markets.closeTime,
        resolvedOutcome: markets.resolvedOutcome,
        slug: markets.slug,
        totalVolume: markets.totalVolume,
        marketType: markets.marketType,
        asset: markets.asset,
        strikePrice: markets.strikePrice,
        recurringGroupId: markets.recurringGroupId,
      })
      .from(markets)
      .where(where)
      .orderBy(orderBy)
      .limit(limitParam)
      .offset(offsetParam),
    db.select({ total: count() }).from(markets).where(where),
  ]);

  return {
    markets: rows.map((market) => ({
      ...market,
      yesPrice: Number(market.yesPrice),
      noPrice: Number(market.noPrice),
      yesDemand: Number(market.yesDemand),
      noDemand: Number(market.noDemand),
      totalVolume: Number(market.totalVolume),
      strikePrice: market.strikePrice ? Number(market.strikePrice) : null,
      closeTime: market.closeTime?.toISOString() ?? null,
    })),
    total,
    limit: limitParam,
    offset: offsetParam,
  };
}
