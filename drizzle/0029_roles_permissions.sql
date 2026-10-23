CREATE TABLE "role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base" "staff_role" NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"role_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"action" text NOT NULL,
	"allowed" boolean NOT NULL,
	CONSTRAINT "role_permission_role_id_feature_action_pk" PRIMARY KEY("role_id","feature","action")
);
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The three built-in roles, matching the access everyone has today.
INSERT INTO "role" ("name", "base", "system") VALUES ('Admin', 'admin', true), ('Manager', 'manager', true), ('Staff', 'staff', true);--> statement-breakpoint
UPDATE "staff" SET "role_id" = (SELECT "id" FROM "role" WHERE "role"."base" = "staff"."role" AND "role"."system");
