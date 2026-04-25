CREATE TABLE "eco_event_calendar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"release_time_sec" bigint NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"spawned_series_id" text,
	"spawned_round_idx" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases_v3" ADD COLUMN "strike_kind_captured" text;--> statement-breakpoint
ALTER TABLE "cases_v3" ADD COLUMN "barrier_low_price_e8" bigint;--> statement-breakpoint
ALTER TABLE "cases_v3" ADD COLUMN "barrier_high_price_e8" bigint;--> statement-breakpoint
ALTER TABLE "cases_v3" ADD COLUMN "vol_source_tag" text;--> statement-breakpoint
ALTER TABLE "cases_v3" ADD COLUMN "vol_is_fresh" smallint;--> statement-breakpoint
ALTER TABLE "cases_v3" ADD COLUMN "release_time_sec" bigint;--> statement-breakpoint
ALTER TABLE "cases_v3" ADD COLUMN "freeze_at_sec" bigint;--> statement-breakpoint
ALTER TABLE "cases_v3" ADD COLUMN "actual_released_price_e8" bigint;--> statement-breakpoint
ALTER TABLE "cases_v3" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "series_v3" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "series_v3" ADD COLUMN "duration_sec_hint" integer;--> statement-breakpoint
ALTER TABLE "series_v3" ADD COLUMN "strike_kind" text;--> statement-breakpoint
ALTER TABLE "series_v3" ADD COLUMN "kind" text DEFAULT 'rolling' NOT NULL;--> statement-breakpoint
ALTER TABLE "series_v3" ADD COLUMN "event_type" text;--> statement-breakpoint
ALTER TABLE "series_v3" ADD COLUMN "pm_amm_l_dollars" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "eco_event_calendar_event_time_uniq" ON "eco_event_calendar" USING btree ("event_type","release_time_sec");--> statement-breakpoint
CREATE INDEX "eco_event_calendar_status_time_idx" ON "eco_event_calendar" USING btree ("status","release_time_sec");--> statement-breakpoint
CREATE INDEX "cases_v3_release_time_idx" ON "cases_v3" USING btree ("release_time_sec");--> statement-breakpoint
CREATE INDEX "series_v3_kind_idx" ON "series_v3" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "series_v3_group_idx" ON "series_v3" USING btree ("group_id");