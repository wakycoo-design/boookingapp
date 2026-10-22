ALTER TABLE "business" ALTER COLUMN "slot_interval_min" SET DEFAULT 30;--> statement-breakpoint
-- Start times every 30 minutes instead of 15: the firm-wide setting and any service that chose 15.
UPDATE "business" SET "slot_interval_min" = 30 WHERE "slot_interval_min" = 15;--> statement-breakpoint
UPDATE "service" SET "slot_interval_min" = 30 WHERE "slot_interval_min" = 15;
