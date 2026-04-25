CREATE TABLE "positions_v3" (
	"user_address" text NOT NULL,
	"series_id" text NOT NULL,
	"round_idx" bigint NOT NULL,
	"side" "bet_side_v3" NOT NULL,
	"shares_e8" bigint DEFAULT 0 NOT NULL,
	"cost_basis_cents" bigint DEFAULT 0 NOT NULL,
	"realized_pnl_cents" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_v3_user_address_series_id_round_idx_side_pk" PRIMARY KEY("user_address","series_id","round_idx","side")
);
--> statement-breakpoint
ALTER TABLE "cases_v3" ADD COLUMN "up_shares_e8" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cases_v3" ADD COLUMN "down_shares_e8" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders_v3" ADD COLUMN "shares_e8" bigint;--> statement-breakpoint
ALTER TABLE "orders_v3" ADD COLUMN "is_buy" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "positions_v3_user_idx" ON "positions_v3" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "positions_v3_case_idx" ON "positions_v3" USING btree ("series_id","round_idx");