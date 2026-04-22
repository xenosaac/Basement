CREATE TYPE "public"."market_category" AS ENUM('crypto_3min', 'crypto_weekly');--> statement-breakpoint
CREATE TYPE "public"."market_state" AS ENUM('OPEN', 'CLOSED', 'RESOLVED', 'SETTLED');--> statement-breakpoint
CREATE TYPE "public"."market_type" AS ENUM('MIRRORED', 'RECURRING');--> statement-breakpoint
CREATE TYPE "public"."settlement_type" AS ENUM('oracle_auto', 'admin_resolve');--> statement-breakpoint
CREATE TYPE "public"."side" AS ENUM('YES', 'NO');--> statement-breakpoint
CREATE TYPE "public"."vault_event_type" AS ENUM('case_created', 'bought_yes', 'bought_no', 'sold_yes', 'sold_no', 'claimed', 'resolved', 'paused', 'drained', 'liquidity_seeded', 'faucet_claimed', 'market_created');--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"market_id" text NOT NULL,
	"payout" numeric(20, 6) NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL,
	"source_event_id" uuid,
	CONSTRAINT "claims_user_market_uniq" UNIQUE("user_address","market_id")
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"question" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_url" text,
	"state" "market_state" DEFAULT 'OPEN' NOT NULL,
	"market_type" "market_type" DEFAULT 'MIRRORED' NOT NULL,
	"asset" text,
	"strike_price" numeric(20, 2),
	"recurring_group_id" text,
	"yes_demand" numeric(20, 6) DEFAULT '1' NOT NULL,
	"no_demand" numeric(20, 6) DEFAULT '1' NOT NULL,
	"yes_price" numeric(10, 6) DEFAULT '0.5' NOT NULL,
	"no_price" numeric(10, 6) DEFAULT '0.5' NOT NULL,
	"total_volume" numeric(20, 6) DEFAULT '0' NOT NULL,
	"open_time" timestamp DEFAULT now() NOT NULL,
	"close_time" timestamp,
	"resolved_outcome" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"market_object_address" text,
	"category" "market_category" DEFAULT 'crypto_3min',
	"oracle_feed_id" text,
	"oracle_last_price" bigint,
	"pyth_vaa_last_bytes" "bytea",
	"pyth_vaa_last_updated_at" timestamp with time zone,
	"settlement_type" "settlement_type" DEFAULT 'oracle_auto',
	"question_hash" text,
	"metadata_hash" text,
	"fee_bps" integer DEFAULT 200 NOT NULL,
	"on_chain_state" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "markets_slug_unique" UNIQUE("slug"),
	CONSTRAINT "markets_market_object_address_unique" UNIQUE("market_object_address")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"market_id" text NOT NULL,
	"side" "side" NOT NULL,
	"amount_spent" numeric(20, 6) DEFAULT '0' NOT NULL,
	"shares_received" numeric(20, 6) DEFAULT '0' NOT NULL,
	"avg_price" numeric(10, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"source_event_id" uuid,
	CONSTRAINT "positions_user_market_side_uniq" UNIQUE("user_address","market_id","side")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"market_id" text NOT NULL,
	"side" "side" NOT NULL,
	"amount_spent" numeric(20, 6) NOT NULL,
	"shares_received" numeric(20, 6) NOT NULL,
	"price_at_trade" numeric(10, 6) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"source_event_id" uuid
);
--> statement-breakpoint
CREATE TABLE "users" (
	"address" text PRIMARY KEY NOT NULL,
	"balance" numeric(20, 6) DEFAULT '0' NOT NULL,
	"faucet_claimed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"txn_hash" text NOT NULL,
	"event_seq" integer NOT NULL,
	"event_type" "vault_event_type" NOT NULL,
	"case_id" bigint,
	"user_address" text,
	"amount_virtual_usd_raw" bigint,
	"shares_raw" bigint,
	"side" smallint,
	"outcome" smallint,
	"yes_reserve_after" bigint,
	"no_reserve_after" bigint,
	"block_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "vault_events_txn_seq_uniq" UNIQUE("txn_hash","event_seq")
);
--> statement-breakpoint
CREATE TABLE "vault_indexer_cursor" (
	"event_type" text PRIMARY KEY NOT NULL,
	"last_processed_sequence" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_address_users_address_fk" FOREIGN KEY ("user_address") REFERENCES "public"."users"("address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_source_event_id_vault_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."vault_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_address_users_address_fk" FOREIGN KEY ("user_address") REFERENCES "public"."users"("address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_source_event_id_vault_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."vault_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_address_users_address_fk" FOREIGN KEY ("user_address") REFERENCES "public"."users"("address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_source_event_id_vault_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."vault_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_nonces_addr_expires_idx" ON "auth_nonces" USING btree ("address","expires_at");--> statement-breakpoint
CREATE INDEX "claims_user_idx" ON "claims" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "markets_state_idx" ON "markets" USING btree ("state");--> statement-breakpoint
CREATE INDEX "markets_created_at_idx" ON "markets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "markets_volume_idx" ON "markets" USING btree ("total_volume");--> statement-breakpoint
CREATE INDEX "markets_recurring_group_idx" ON "markets" USING btree ("recurring_group_id");--> statement-breakpoint
CREATE INDEX "markets_type_state_created_idx" ON "markets" USING btree ("market_type","state","created_at");--> statement-breakpoint
CREATE INDEX "markets_type_state_close_idx" ON "markets" USING btree ("market_type","state","close_time");--> statement-breakpoint
CREATE INDEX "markets_recurring_state_close_idx" ON "markets" USING btree ("recurring_group_id","state","close_time");--> statement-breakpoint
CREATE INDEX "markets_category_idx" ON "markets" USING btree ("category");--> statement-breakpoint
CREATE INDEX "positions_user_idx" ON "positions" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "positions_market_idx" ON "positions" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "trades_market_idx" ON "trades" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "trades_user_idx" ON "trades" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "trades_market_created_idx" ON "trades" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE INDEX "vault_events_type_time_idx" ON "vault_events" USING btree ("event_type","block_time");--> statement-breakpoint
CREATE INDEX "vault_events_user_idx" ON "vault_events" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "vault_events_case_idx" ON "vault_events" USING btree ("case_id");--> statement-breakpoint
-- Seed vault_indexer_cursor with one row per event_type at sequence 0.
INSERT INTO "vault_indexer_cursor" ("event_type", "last_processed_sequence") VALUES
  ('case_created', 0),
  ('bought_yes', 0),
  ('bought_no', 0),
  ('sold_yes', 0),
  ('sold_no', 0),
  ('claimed', 0),
  ('resolved', 0),
  ('paused', 0),
  ('drained', 0),
  ('liquidity_seeded', 0),
  ('faucet_claimed', 0),
  ('market_created', 0)
ON CONFLICT ("event_type") DO NOTHING;
