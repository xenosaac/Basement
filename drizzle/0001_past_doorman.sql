DROP TABLE "claims" CASCADE;--> statement-breakpoint
DROP TABLE "positions" CASCADE;--> statement-breakpoint
DROP TABLE "trades" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "balance";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "faucet_claimed_at";