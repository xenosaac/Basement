import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  numeric,
  timestamp,
  pgEnum,
  index,
  unique,
  uniqueIndex,
  uuid,
  bigint,
  smallint,
  integer,
  jsonb,
  customType,
  primaryKey,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────

export const marketStateEnum = pgEnum("market_state", [
  "OPEN",
  "CLOSED",
  "RESOLVED",
  "SETTLED",
]);

export const marketTypeEnum = pgEnum("market_type", ["MIRRORED", "RECURRING"]);

export const sideEnum = pgEnum("side", ["YES", "NO"]);

// Session D additive enums
export const marketCategoryEnum = pgEnum("market_category", [
  "crypto_3min",
  "crypto_weekly",
]);

export const settlementTypeEnum = pgEnum("settlement_type", [
  "oracle_auto",
  "admin_resolve",
]);

export const vaultEventTypeEnum = pgEnum("vault_event_type", [
  "case_created",
  "bought_yes",
  "bought_no",
  "sold_yes",
  "sold_no",
  "claimed",
  "resolved",
  "paused",
  "drained",
  "liquidity_seeded",
  "faucet_claimed",
  "market_created",
]);

// PostgreSQL BYTEA custom type (drizzle-orm lacks first-class BYTEA)
const bytea = customType<{ data: Uint8Array; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

// ─── Users ───────────────────────────────────────────────

export const users = pgTable("users", {
  address: text("address").primaryKey(), // wallet address, lowercase
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Markets ─────────────────────────────────────────────

export const markets = pgTable(
  "markets",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull().unique(),
    question: text("question").notNull(),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url"),

    state: marketStateEnum("state").notNull().default("OPEN"),
    marketType: marketTypeEnum("market_type").notNull().default("MIRRORED"),

    // Recurring market fields
    asset: text("asset"), // "BTC" or "ETH" for recurring markets
    strikePrice: numeric("strike_price", { precision: 20, scale: 2 }),
    recurringGroupId: text("recurring_group_id"), // e.g. "btc-15m", "eth-15m"

    // AMM state — stored as strings via numeric for precision
    yesDemand: numeric("yes_demand", { precision: 20, scale: 6 }).notNull().default("1"),
    noDemand: numeric("no_demand", { precision: 20, scale: 6 }).notNull().default("1"),

    // Pre-computed prices — updated on every trade, avoids read-time computation
    yesPrice: numeric("yes_price", { precision: 10, scale: 6 }).notNull().default("0.5"),
    noPrice: numeric("no_price", { precision: 10, scale: 6 }).notNull().default("0.5"),

    // Pre-computed volume — incremented on trade
    totalVolume: numeric("total_volume", { precision: 20, scale: 6 }).notNull().default("0"),

    openTime: timestamp("open_time").notNull().defaultNow(),
    closeTime: timestamp("close_time"),
    resolvedOutcome: text("resolved_outcome"), // "YES" or "NO"
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),

    // ─── Session D additive (on-chain linkage) ──────────────
    marketObjectAddress: text("market_object_address").unique(),
    category: marketCategoryEnum("category").default("crypto_3min"),
    oracleFeedId: text("oracle_feed_id"),
    oracleLastPrice: bigint("oracle_last_price", { mode: "bigint" }),
    pythVaaLastBytes: bytea("pyth_vaa_last_bytes"),
    pythVaaLastUpdatedAt: timestamp("pyth_vaa_last_updated_at", { withTimezone: true }),
    settlementType: settlementTypeEnum("settlement_type").default("oracle_auto"),
    questionHash: text("question_hash"),
    metadataHash: text("metadata_hash"),
    feeBps: integer("fee_bps").notNull().default(200),
    onChainState: smallint("on_chain_state").notNull().default(0),

    // On-chain CaseVault id for RECURRING rows. Nullable so historical
    // MIRRORED rows coexist (Postgres unique allows multiple NULLs).
    caseId: bigint("case_id", { mode: "bigint" }),
  },
  (t) => [
    index("markets_state_idx").on(t.state),
    index("markets_created_at_idx").on(t.createdAt),
    index("markets_volume_idx").on(t.totalVolume),
    index("markets_recurring_group_idx").on(t.recurringGroupId),
    index("markets_type_state_created_idx").on(t.marketType, t.state, t.createdAt),
    index("markets_type_state_close_idx").on(t.marketType, t.state, t.closeTime),
    index("markets_recurring_state_close_idx").on(t.recurringGroupId, t.state, t.closeTime),
    index("markets_category_idx").on(t.category),
    uniqueIndex("markets_case_id_unique").on(t.caseId),
  ]
);

// ─── Session D additive tables ───────────────────────────

// T3 auth nonce persistence (replaces in-memory stub).
export const authNonces = pgTable(
  "auth_nonces",
  {
    nonce: text("nonce").primaryKey(),
    address: text("address").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("auth_nonces_addr_expires_idx").on(t.address, t.expiresAt)]
);

// T7 indexer target; not a ledger — rebuildable from chain.
export const vaultEvents = pgTable(
  "vault_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    txnHash: text("txn_hash").notNull(),
    eventSeq: integer("event_seq").notNull(),
    eventType: vaultEventTypeEnum("event_type").notNull(),
    caseId: bigint("case_id", { mode: "bigint" }),
    userAddress: text("user_address"),
    amountVirtualUsdRaw: bigint("amount_virtual_usd_raw", { mode: "bigint" }),
    sharesRaw: bigint("shares_raw", { mode: "bigint" }),
    side: smallint("side"),
    outcome: smallint("outcome"),
    yesReserveAfter: bigint("yes_reserve_after", { mode: "bigint" }),
    noReserveAfter: bigint("no_reserve_after", { mode: "bigint" }),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull(),
  },
  (t) => [
    unique("vault_events_txn_seq_uniq").on(t.txnHash, t.eventSeq),
    index("vault_events_type_time_idx").on(t.eventType, t.blockTime),
    index("vault_events_user_idx").on(t.userAddress),
    index("vault_events_case_idx").on(t.caseId),
  ]
);

// T7 indexer cursor per event_type.
export const vaultIndexerCursor = pgTable("vault_indexer_cursor", {
  eventType: text("event_type").primaryKey(),
  lastProcessedSequence: bigint("last_processed_sequence", { mode: "bigint" }).notNull().default(sql`0`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Portfolio case discovery hints — written by the client after a confirmed
// buy/sell tx so /api/portfolio/cases can surface the case before the vault
// indexer catches up. Discovery only; never a source of truth for balances.
export const portfolioCaseHints = pgTable(
  "portfolio_case_hints",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userAddress: text("user_address").notNull(),
    caseId: bigint("case_id", { mode: "bigint" }).notNull(),
    txnHash: text("txn_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("portfolio_case_hints_user_case_uniq").on(t.userAddress, t.caseId),
    index("portfolio_case_hints_user_idx").on(t.userAddress),
  ]
);

// ─── v3 Semi-custodial Web2 tables (Session 1, 2026-04-24) ────
// Integer cents everywhere (1 USDC = 100 cents). No DECIMAL.
// These coexist with v1 tables during transition; v1 is read-only.

export const caseStateEnumV3 = pgEnum("case_state_v3", [
  "OPEN",
  "CLOSED",
  "RESOLVED",
  "VOID",
]);
export const outcomeEnumV3 = pgEnum("outcome_v3", [
  "UP",
  "DOWN",
  "INVALID",
]);
export const betSideEnumV3 = pgEnum("bet_side_v3", ["UP", "DOWN"]);
export const seriesCategoryEnumV3 = pgEnum("series_category_v3", [
  "quick_play",
  "commodity",
  "stocks",
  "crypto_ext",
]);

export const seriesV3 = pgTable(
  "series_v3",
  {
    seriesId: text("series_id").primaryKey(), // e.g. "btc-usdc-3m"
    assetSymbol: text("asset_symbol").notNull(), // "BTC"
    pair: text("pair").notNull(), // "BTC/USDC"
    category: seriesCategoryEnumV3("category").notNull(),
    cadenceSec: integer("cadence_sec").notNull(), // 180 or 3600
    pythFeedId: text("pyth_feed_id").notNull(), // 64-char hex without 0x
    seriesStartSec: bigint("series_start_sec", { mode: "number" }).notNull(),
    marketHoursGated: smallint("market_hours_gated").notNull().default(0), // 0/1 boolean
    feeBps: integer("fee_bps").notNull().default(200), // 2%
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: smallint("is_active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("series_v3_category_idx").on(t.category)],
);

export const casesV3 = pgTable(
  "cases_v3",
  {
    // composite PK (series_id, round_idx)
    seriesId: text("series_id")
      .notNull()
      .references(() => seriesV3.seriesId),
    roundIdx: bigint("round_idx", { mode: "number" }).notNull(),
    startTimeSec: bigint("start_time_sec", { mode: "number" }).notNull(),
    closeTimeSec: bigint("close_time_sec", { mode: "number" }).notNull(),
    // Strike set when first Pyth tick in window captured
    strikePriceE8: bigint("strike_price_e8", { mode: "bigint" }),
    strikeCents: bigint("strike_cents", { mode: "bigint" }), // strike_price_e8 / 1e6 (USDC 6-dec → cents 2-dec: /1e4 + Pyth /1e8 = /1e4 on Pyth e8)
    // Final outcome
    resolvedPriceE8: bigint("resolved_price_e8", { mode: "bigint" }),
    resolvedOutcome: outcomeEnumV3("resolved_outcome"),
    // Legacy parimutuel pool totals (kept for stake-weighted analytics).
    upPoolCents: bigint("up_pool_cents", { mode: "bigint" }).notNull().default(sql`0`),
    downPoolCents: bigint("down_pool_cents", { mode: "bigint" }).notNull().default(sql`0`),
    // LMSR state: outstanding YES/NO shares (E8). Both start at 0 → 50/50
    // initial price. Cost-of-buy = C(q+Δ) - C(q) where C is the LMSR cost
    // function with liquidity parameter b. See src/lib/lmsr.ts.
    upSharesE8: bigint("up_shares_e8", { mode: "bigint" }).notNull().default(sql`0`),
    downSharesE8: bigint("down_shares_e8", { mode: "bigint" }).notNull().default(sql`0`),
    state: caseStateEnumV3("state").notNull().default("OPEN"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.roundIdx] }),
    index("cases_v3_state_close_idx").on(t.state, t.closeTimeSec),
    index("cases_v3_series_round_desc_idx").on(t.seriesId, t.roundIdx),
  ],
);

export const ordersV3 = pgTable(
  "orders_v3",
  {
    orderId: uuid("order_id").primaryKey().default(sql`gen_random_uuid()`),
    userAddress: text("user_address").notNull(),
    seriesId: text("series_id").notNull(),
    roundIdx: bigint("round_idx", { mode: "number" }).notNull(),
    side: betSideEnumV3("side").notNull(),
    // Buys: amountCents > 0 = stake spent. Sells: amountCents > 0 = proceeds
    // received (positive number; isBuy=0 distinguishes direction).
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    // Shares delta in E8 (1e8 = 1 share). Buys add shares to the user's
    // position; sells remove. Null on legacy parimutuel rows.
    sharesE8: bigint("shares_e8", { mode: "bigint" }),
    isBuy: smallint("is_buy").notNull().default(1), // 1 = buy, 0 = sell
    nonce: text("nonce").notNull(), // dedupe + signed payload audit
    placedAtSec: bigint("placed_at_sec", { mode: "number" }).notNull(),
    payoutCents: bigint("payout_cents", { mode: "bigint" }), // null until resolve
  },
  (t) => [
    uniqueIndex("orders_v3_nonce_uniq").on(t.nonce),
    index("orders_v3_user_time_idx").on(t.userAddress, t.placedAtSec),
    index("orders_v3_case_idx").on(t.seriesId, t.roundIdx, t.side),
  ],
);

// Per-(user, case, side) running position. One row per side a user holds in
// a given round; updated atomically with each buy/sell.
export const positionsV3 = pgTable(
  "positions_v3",
  {
    userAddress: text("user_address").notNull(),
    seriesId: text("series_id").notNull(),
    roundIdx: bigint("round_idx", { mode: "number" }).notNull(),
    side: betSideEnumV3("side").notNull(),
    // Net shares held (E8). Cannot go negative.
    sharesE8: bigint("shares_e8", { mode: "bigint" }).notNull().default(sql`0`),
    // Total cents spent acquiring current sharesE8 (proportionally reduced on
    // sells using avg-cost basis).
    costBasisCents: bigint("cost_basis_cents", { mode: "bigint" }).notNull().default(sql`0`),
    // Cumulative realized P&L from sells + final settle in this position
    // (= sell proceeds − corresponding cost basis + settle value − remaining cost basis).
    realizedPnlCents: bigint("realized_pnl_cents", { mode: "bigint" }).notNull().default(sql`0`),
    // Set when user claims a winning resolved position. NULL = unclaimed
    // (either still OPEN, or RESOLVED but waiting for user to press Claim).
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userAddress, t.seriesId, t.roundIdx, t.side] }),
    index("positions_v3_user_idx").on(t.userAddress),
    index("positions_v3_case_idx").on(t.seriesId, t.roundIdx),
  ],
);

export const userBalancesV3 = pgTable("user_balances_v3", {
  address: text("address").primaryKey(),
  availableCents: bigint("available_cents", { mode: "bigint" }).notNull().default(sql`0`),
  lockedCents: bigint("locked_cents", { mode: "bigint" }).notNull().default(sql`0`),
  totalDepositsCents: bigint("total_deposits_cents", { mode: "bigint" }).notNull().default(sql`0`),
  totalWithdrawalsCents: bigint("total_withdrawals_cents", { mode: "bigint" }).notNull().default(sql`0`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const faucetClaimsV3 = pgTable(
  "faucet_claims_v3",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userAddress: text("user_address").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    claimedAtSec: bigint("claimed_at_sec", { mode: "number" }).notNull(),
  },
  (t) => [index("faucet_claims_v3_user_time_idx").on(t.userAddress, t.claimedAtSec)],
);

export const priceTicksV3 = pgTable(
  "price_ticks_v3",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    pythFeedId: text("pyth_feed_id").notNull(),
    priceE8: bigint("price_e8", { mode: "bigint" }).notNull(),
    publishTimeSec: bigint("publish_time_sec", { mode: "number" }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("price_ticks_v3_feed_time_idx").on(t.pythFeedId, t.publishTimeSec),
    uniqueIndex("price_ticks_v3_feed_publish_uniq").on(t.pythFeedId, t.publishTimeSec),
  ],
);

// ─── Types ───────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;
export type AuthNonce = typeof authNonces.$inferSelect;
export type NewAuthNonce = typeof authNonces.$inferInsert;
export type VaultEvent = typeof vaultEvents.$inferSelect;
export type NewVaultEvent = typeof vaultEvents.$inferInsert;
export type VaultIndexerCursor = typeof vaultIndexerCursor.$inferSelect;
export type PortfolioCaseHint = typeof portfolioCaseHints.$inferSelect;
export type NewPortfolioCaseHint = typeof portfolioCaseHints.$inferInsert;

// v3
export type SeriesRow = typeof seriesV3.$inferSelect;
export type NewSeriesRow = typeof seriesV3.$inferInsert;
export type CaseRow = typeof casesV3.$inferSelect;
export type NewCaseRow = typeof casesV3.$inferInsert;
export type OrderRowDb = typeof ordersV3.$inferSelect;
export type NewOrderRowDb = typeof ordersV3.$inferInsert;
export type PositionRow = typeof positionsV3.$inferSelect;
export type NewPositionRow = typeof positionsV3.$inferInsert;
export type UserBalance = typeof userBalancesV3.$inferSelect;
export type NewUserBalance = typeof userBalancesV3.$inferInsert;
export type FaucetClaim = typeof faucetClaimsV3.$inferSelect;
export type NewFaucetClaim = typeof faucetClaimsV3.$inferInsert;
export type PriceTick = typeof priceTicksV3.$inferSelect;
export type NewPriceTick = typeof priceTicksV3.$inferInsert;
