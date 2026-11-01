CREATE TABLE "webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"detail" text NOT NULL,
	"provider_message_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_event_kind" CHECK ("webhook_event"."kind" in ('message', 'status', 'template', 'other'))
);
--> statement-breakpoint
CREATE INDEX "webhook_event_received_idx" ON "webhook_event" USING btree ("received_at");