import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  numeric,
  timestamp,
  pgEnum,
  index,
  unique,
  uuid,
  bigint,
  smallint,
  integer,
  jsonb,
  customType,
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
  balance: numeric("balance", { precision: 20, scale: 6 }).notNull().default("0"),
  faucetClaimedAt: timestamp("faucet_claimed_at"),
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

// ─── Positions ───────────────────────────────────────────

export const positions = pgTable(
  "positions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userAddress: text("user_address").notNull().references(() => users.address),
    marketId: text("market_id").notNull().references(() => markets.id),
    side: sideEnum("side").notNull(),
    amountSpent: numeric("amount_spent", { precision: 20, scale: 6 }).notNull().default("0"),
    sharesReceived: numeric("shares_received", { precision: 20, scale: 6 }).notNull().default("0"),
    avgPrice: numeric("avg_price", { precision: 10, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    sourceEventId: uuid("source_event_id").references(() => vaultEvents.id),
  },
  (t) => [
    unique("positions_user_market_side_uniq").on(t.userAddress, t.marketId, t.side),
    index("positions_user_idx").on(t.userAddress),
    index("positions_market_idx").on(t.marketId),
  ]
);

// ─── Trades (append-only log) ────────────────────────────

export const trades = pgTable(
  "trades",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userAddress: text("user_address").notNull().references(() => users.address),
    marketId: text("market_id").notNull().references(() => markets.id),
    side: sideEnum("side").notNull(),
    amountSpent: numeric("amount_spent", { precision: 20, scale: 6 }).notNull(),
    sharesReceived: numeric("shares_received", { precision: 20, scale: 6 }).notNull(),
    priceAtTrade: numeric("price_at_trade", { precision: 10, scale: 6 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    sourceEventId: uuid("source_event_id").references(() => vaultEvents.id),
  },
  (t) => [
    index("trades_market_idx").on(t.marketId),
    index("trades_user_idx").on(t.userAddress),
    index("trades_market_created_idx").on(t.marketId, t.createdAt),
  ]
);

// ─── Claims ──────────────────────────────────────────────

export const claims = pgTable(
  "claims",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userAddress: text("user_address").notNull().references(() => users.address),
    marketId: text("market_id").notNull().references(() => markets.id),
    payout: numeric("payout", { precision: 20, scale: 6 }).notNull(),
    claimedAt: timestamp("claimed_at").notNull().defaultNow(),
    sourceEventId: uuid("source_event_id").references(() => vaultEvents.id),
  },
  (t) => [
    unique("claims_user_market_uniq").on(t.userAddress, t.marketId),
    index("claims_user_idx").on(t.userAddress),
  ]
);

// ─── Types ───────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type Market = typeof markets.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type Claim = typeof claims.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;
export type AuthNonce = typeof authNonces.$inferSelect;
export type NewAuthNonce = typeof authNonces.$inferInsert;
export type VaultEvent = typeof vaultEvents.$inferSelect;
export type NewVaultEvent = typeof vaultEvents.$inferInsert;
export type VaultIndexerCursor = typeof vaultIndexerCursor.$inferSelect;
