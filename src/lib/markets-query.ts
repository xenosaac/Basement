import {
  and,
  asc,
  count,
  desc,
  eq,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { casesV3, markets, seriesV3 } from "@/db/schema";
import {
  aptos,
  moduleAddress,
  readCaseState,
  type MarketCreatedEvent,
} from "@/lib/aptos";
import {
  activePythGroups,
  isActiveRecurringGroupId,
  renderQuestion,
  type MarketGroupSpec,
} from "@/lib/market-groups";
import { settlementDisplayPrices } from "@/lib/market-settlement";
import type { MarketWithPrices, MarketsResponse } from "@/types";

const VALID_STATES: readonly string[] = ["OPEN", "CLOSED", "RESOLVED", "SETTLED"];
// Registry-driven. Every active `pyth` group in market-groups.ts is covered
// here; adding a new recurring market only requires a registry entry.
const RECURRING_SPECS: readonly MarketGroupSpec[] = activePythGroups();
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

/* ---------------------------------------------------------------------------
 * Recurring market row materialization — always keyed by on-chain caseId.
 *
 * The canonical source of truth is `market_factory::MarketCreatedEvent`.
 * This function writes/updates the DB row so `caseId` mirrors the chain, and
 * closes any older OPEN row in the same group (prevents two-cards-one-group).
 * ------------------------------------------------------------------------ */

/**
 * Phase D dynamic-strike spawn payload. When present, the upsert helper
 * additionally writes a `cases_v3` row carrying the strike-kind capture +
 * barrier prices + vol-estimator audit fields, lazily ensuring a `series_v3`
 * row exists for the group (so the FK on `cases_v3.series_id` holds).
 *
 * Legacy strategies (`spawn_recurring_3min` / `create_market`) leave this
 * undefined and only write `markets` — preserving v0.5 backward compat.
 */
export interface DynamicStrikeUpsert {
  /** 'absolute_above' | 'absolute_below' | 'barrier_two_sided'. */
  strikeKind: string;
  /** Round duration hint in seconds (15min=900, 1h=3600, 1d=86400). */
  durationSec: number;
  /** Spawn time (Unix sec). */
  startTimeSec: number;
  /** UI-side category for the new seriesV3 row. Falls back to 'crypto_ext'
   *  when the group's category doesn't map cleanly to seriesV3 enum. */
  seriesCategory: "quick_play" | "commodity" | "stocks" | "crypto_ext";
  /** Pyth feed id (lowercase hex, no 0x). Used for both seriesV3 and cases. */
  pythFeedId: string;
  /** Per-Pyth-expo strike price (raw integer at `spec.priceExpo`). For
   *  barrier cases this is the upper barrier — kept for chain-side display
   *  parity. v0 settles in DB so the casesV3 columns drive resolution. */
  strikePriceE8: bigint;
  /** Lower barrier (only for barrier_two_sided). NULL otherwise. */
  barrierLowPriceE8?: bigint | null;
  /** Upper barrier (only for barrier_two_sided). NULL otherwise. */
  barrierHighPriceE8?: bigint | null;
  /** Vol-estimator source tag ('samples' | 'fallback'). */
  volSourceTag: string;
  /** Vol freshness flag (0/1) at spawn time. */
  volIsFresh: 0 | 1;
}

export interface UpsertRecurringInput {
  spec: MarketGroupSpec;
  event: MarketCreatedEvent;
  state?: "OPEN" | "CLOSED";
  /** Optional Phase D dynamic-strike payload. When provided, the helper
   *  additionally upserts a `cases_v3` row + `series_v3` lazy row. */
  dynamic?: DynamicStrikeUpsert;
}

/**
 * Lazily upsert a `series_v3` row for a v0.5 dynamic-strike market group.
 * Idempotent — `onConflictDoNothing` on the seriesId PK so concurrent spawns
 * are safe. Used only for groups whose seriesId == groupId (Phase D
 * convention; pre-v0.5 legacy seriesIds keep their own bespoke ids).
 */
async function ensureSeriesV3RowForGroup(
  spec: MarketGroupSpec,
  payload: DynamicStrikeUpsert,
): Promise<void> {
  // Use the spec's groupId verbatim as the series_v3.seriesId. New v0.5
  // groups are 1:1 with seriesV3 rows — earlier 3m/legacy seriesIds carry
  // their own pair-based ids ("btc-usdc-3m") and predate this helper.
  const seriesId = spec.groupId;

  // Cadence in seconds for the cron poll interval — equal to durationSec
  // for v0.5 (one round per duration). seriesStartSec anchors round_idx
  // computations; for spawn-recurring groups the v3 round_idx is set
  // explicitly per spawn (round_idx == case_id), so the anchor is informational.
  await db
    .insert(seriesV3)
    .values({
      seriesId,
      assetSymbol: spec.assetSymbol,
      pair: `${spec.assetSymbol}/USDC`,
      category: payload.seriesCategory,
      cadenceSec: payload.durationSec,
      pythFeedId: payload.pythFeedId,
      seriesStartSec: payload.startTimeSec,
      marketHoursGated:
        spec.spawnStrategy.kind === "create_market_dynamic_strike" &&
        spec.spawnStrategy.marketHours &&
        spec.spawnStrategy.marketHours !== "always"
          ? 1
          : 0,
      feeBps:
        spec.spawnStrategy.kind === "create_market_dynamic_strike"
          ? spec.spawnStrategy.feeBps
          : 200,
      sortOrder: 100,
      isActive: spec.active ? 1 : 0,
      groupId: spec.groupId,
      durationSecHint: payload.durationSec,
      strikeKind: payload.strikeKind,
      kind: "rolling",
    })
    .onConflictDoNothing();
}

export async function upsertRecurringMarketRowFromChain({
  spec,
  event,
  state = "OPEN",
  dynamic,
}: UpsertRecurringInput): Promise<void> {
  const closeTimeSec = Number(event.closeTime);
  const question = renderQuestion(spec, event.strikePrice, closeTimeSec);
  const assetName = humanAssetName(spec.assetSymbol);
  const strikeDisplay = Number(event.strikePrice) * Math.pow(10, spec.priceExpo);
  const description = `Resolves YES if ${assetName} price at close is higher than at open. Price sourced from Pyth.`;
  const slug = `${spec.groupId}-${event.caseId.toString()}`;

  // Close any older OPEN row in the same group that isn't this caseId. Safety
  // net — normally there shouldn't be one, but we don't want two OPEN rows.
  await db
    .update(markets)
    .set({ state: "CLOSED" })
    .where(
      and(
        eq(markets.recurringGroupId, spec.groupId),
        eq(markets.state, "OPEN"),
        or(isNull(markets.caseId), ne(markets.caseId, event.caseId)),
      ),
    );

  await db
    .insert(markets)
    .values({
      slug,
      question,
      description,
      state,
      marketType: "RECURRING",
      asset: spec.assetSymbol,
      strikePrice: String(strikeDisplay),
      recurringGroupId: spec.groupId,
      yesDemand: "1",
      noDemand: "1",
      yesPrice: "0.5",
      noPrice: "0.5",
      totalVolume: "0",
      closeTime: new Date(closeTimeSec * 1000),
      caseId: event.caseId,
      marketObjectAddress: event.vaultAddr,
      oracleFeedId: event.assetPythFeedId || null,
    })
    .onConflictDoUpdate({
      target: markets.caseId,
      set: {
        slug,
        question,
        description,
        state,
        marketType: "RECURRING",
        asset: spec.assetSymbol,
        strikePrice: String(strikeDisplay),
        recurringGroupId: spec.groupId,
        closeTime: new Date(closeTimeSec * 1000),
        marketObjectAddress: event.vaultAddr,
        oracleFeedId: event.assetPythFeedId || null,
        updatedAt: new Date(),
      },
    });

  // ── v0.5 Phase D — dynamic-strike casesV3 shadow row ─────────────────
  // The legacy markets table is the on-chain mirror; cases_v3 is the
  // settle-side source of truth (Phase E reads it). For dynamic-strike
  // groups we lazily ensure the seriesV3 row + write a cases_v3 row keyed
  // by (groupId-as-seriesId, caseId-as-roundIdx). Best-effort: failure
  // here logs but doesn't block the markets-table insert which already
  // succeeded.
  if (dynamic) {
    try {
      await ensureSeriesV3RowForGroup(spec, dynamic);
      await db
        .insert(casesV3)
        .values({
          seriesId: spec.groupId,
          // case_id is a u64 from chain — fits in JS number for v0 demo
          // volumes. If chain case_id ever exceeds Number.MAX_SAFE_INTEGER
          // we'd need to switch roundIdx to bigint mode, but that's a v1
          // schema change.
          roundIdx: Number(event.caseId),
          startTimeSec: dynamic.startTimeSec,
          closeTimeSec,
          strikePriceE8: dynamic.strikePriceE8,
          // strikeCents: USDC-cent rendering for non-PCT feeds. Pyth e8
          // → cents = e8 / 1e6. Matches `pythE8ToCents` semantics.
          strikeCents: dynamic.strikePriceE8 / 1_000_000n,
          state,
          strikeKindCaptured: dynamic.strikeKind,
          barrierLowPriceE8: dynamic.barrierLowPriceE8 ?? null,
          barrierHighPriceE8: dynamic.barrierHighPriceE8 ?? null,
          volSourceTag: dynamic.volSourceTag,
          volIsFresh: dynamic.volIsFresh,
        })
        .onConflictDoNothing();
    } catch (err) {
      console.error(
        `[upsertRecurringMarketRowFromChain] cases_v3 shadow upsert failed for ` +
          `${spec.groupId} caseId=${event.caseId.toString()}:`,
        err,
      );
    }
  }
}

/* Reconcile DB with on-chain active cases for each known group.
 *
 * Strategy:
 *   - view `get_active_market_in_group(groupId)` for each active registry
 *     group.
 *   - If the group has an active case on-chain, readCaseState and upsert a
 *     chain-authoritative DB row.
 *   - If no active case, do NOT create a placeholder DB row; the spawn cron
 *     creates one and this reconciler picks it up on the next cycle.
 *
 * Never writes a RECURRING row with caseId == null. */
async function ensureActiveRecurringMarkets(): Promise<void> {
  const now = new Date();
  const nowSec = Math.floor(now.getTime() / 1000);

  await Promise.all(
    RECURRING_SPECS.map(async (spec) => {
      try {
        // Close expired OPEN rows in this group (regardless of caseId).
        await db
          .update(markets)
          .set({ state: "CLOSED" })
          .where(
            and(
              eq(markets.recurringGroupId, spec.groupId),
              eq(markets.state, "OPEN"),
              lt(markets.closeTime, now),
            ),
          );

        const groupBytes = Array.from(new TextEncoder().encode(spec.groupId));
        const view = (await aptos.view({
          payload: {
            function: `${moduleAddress()}::market_factory::get_active_market_in_group`,
            typeArguments: [],
            functionArguments: [groupBytes],
          },
        })) as [{ vec?: unknown[] }];
        const vec = view[0]?.vec;
        if (!Array.isArray(vec) || vec.length === 0) {
          // No active on-chain case → spawn cron will create one. Do not
          // insert a caseId=null placeholder.
          return;
        }

        const caseId = BigInt(vec[0] as string);
        const state = await readCaseState(caseId);

        // Skip if the chain already resolved/drained — no need to resurrect.
        if (state.state !== 0 && state.state !== 1) return;
        const dbState =
          state.state === 0 && Number(state.closeTime) > nowSec ? "OPEN" : "CLOSED";

        const syntheticEvent: MarketCreatedEvent = {
          caseId,
          vaultAddr: state.vaultAddress,
          assetPythFeedId: state.assetPythFeedId,
          strikePrice: state.strikePrice,
          closeTime: state.closeTime,
          marketType: state.marketType,
          thresholdType: state.thresholdType,
          recurringGroupId: state.recurringGroupId,
        };

        await upsertRecurringMarketRowFromChain({
          spec,
          event: syntheticEvent,
          state: dbState,
        });
      } catch (err) {
        console.error(`[auto-refresh] Failed to reconcile ${spec.groupId}:`, err);
      }
    }),
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

/* ---------------------------------------------------------------------------
 * Row → API shape + settlement display.
 * ------------------------------------------------------------------------ */

type MarketRow = {
  id: string;
  question: string;
  description: string;
  imageUrl: string | null;
  state: "OPEN" | "CLOSED" | "RESOLVED" | "SETTLED";
  yesPrice: string;
  noPrice: string;
  yesDemand: string;
  noDemand: string;
  closeTime: Date | null;
  resolvedOutcome: string | null;
  slug: string;
  totalVolume: string;
  marketType: "MIRRORED" | "RECURRING";
  asset: string | null;
  strikePrice: string | null;
  recurringGroupId: string | null;
  caseId: bigint | null;
};

export function toMarketWithPrices(row: MarketRow): MarketWithPrices {
  const fallback = {
    yesPrice: Number(row.yesPrice),
    noPrice: Number(row.noPrice),
  };
  const { yesPrice, noPrice } = settlementDisplayPrices(
    row.state,
    row.resolvedOutcome,
    fallback,
  );
  return {
    id: row.id,
    question: row.question,
    description: row.description,
    imageUrl: row.imageUrl,
    state: row.state,
    yesPrice,
    noPrice,
    yesDemand: Number(row.yesDemand),
    noDemand: Number(row.noDemand),
    closeTime: row.closeTime?.toISOString() ?? null,
    resolvedOutcome: row.resolvedOutcome,
    slug: row.slug,
    totalVolume: Number(row.totalVolume),
    marketType: row.marketType,
    asset: row.asset,
    strikePrice: row.strikePrice ? Number(row.strikePrice) : null,
    recurringGroupId: row.recurringGroupId,
    caseId: row.caseId != null ? row.caseId.toString() : null,
  };
}

const MARKET_SELECT = {
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
  caseId: markets.caseId,
} as const;

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
      .select(MARKET_SELECT)
      .from(markets)
      .where(where)
      .orderBy(orderBy)
      .limit(limitParam)
      .offset(offsetParam),
    db.select({ total: count() }).from(markets).where(where),
  ]);

  // Drop recurring rows whose group id is no longer in the active registry
  // (e.g. legacy btc-15m / eth-15m from pre-3m cadence).
  const cleanRows = rows.filter(
    (r) =>
      r.marketType !== "RECURRING" ||
      !r.recurringGroupId ||
      isActiveRecurringGroupId(r.recurringGroupId),
  );

  return {
    markets: cleanRows.map((row) => toMarketWithPrices(row as MarketRow)),
    total: cleanRows.length === rows.length ? total : cleanRows.length,
    limit: limitParam,
    offset: offsetParam,
  };
}

export async function getMarketById(id: string): Promise<MarketWithPrices | null> {
  const [row] = await db
    .select(MARKET_SELECT)
    .from(markets)
    .where(eq(markets.id, id))
    .limit(1);
  if (!row) return null;
  return toMarketWithPrices(row as MarketRow);
}
