ALTER TABLE "business" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "week_start" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "time_format" text DEFAULT '12h' NOT NULL;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "business_hours" jsonb DEFAULT '[]'::jsonb NOT NULL;