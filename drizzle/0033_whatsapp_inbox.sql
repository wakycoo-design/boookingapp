CREATE TABLE "whatsapp_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"wa_message_id" text,
	"status" text NOT NULL,
	"error" text,
	"sent_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "whatsapp_message_wa_message_id_unique" UNIQUE("wa_message_id"),
	CONSTRAINT "whatsapp_message_direction" CHECK ("whatsapp_message"."direction" in ('in', 'out')),
	CONSTRAINT "whatsapp_message_status" CHECK ("whatsapp_message"."status" in ('received', 'sent', 'delivered', 'read', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_sent_by_staff_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_message_client_idx" ON "whatsapp_message" USING btree ("client_id","created_at");