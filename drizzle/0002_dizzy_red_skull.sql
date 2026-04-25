CREATE TABLE "portfolio_case_hints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_address" text NOT NULL,
	"case_id" bigint NOT NULL,
	"txn_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "case_id" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_case_hints_user_case_uniq" ON "portfolio_case_hints" USING btree ("user_address","case_id");--> statement-breakpoint
CREATE INDEX "portfolio_case_hints_user_idx" ON "portfolio_case_hints" USING btree ("user_address");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_case_id_unique" ON "markets" USING btree ("case_id");