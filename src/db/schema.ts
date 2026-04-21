import {
  pgTable,
  text,
  numeric,
  timestamp,
  pgEnum,
  index,
  unique,
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
  },
  (t) => [
    index("markets_state_idx").on(t.state),
    index("markets_created_at_idx").on(t.createdAt),
    index("markets_volume_idx").on(t.totalVolume),
    index("markets_recurring_group_idx").on(t.recurringGroupId),
    index("markets_type_state_created_idx").on(t.marketType, t.state, t.createdAt),
    index("markets_type_state_close_idx").on(t.marketType, t.state, t.closeTime),
    index("markets_recurring_state_close_idx").on(t.recurringGroupId, t.state, t.closeTime),
  ]
);

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
