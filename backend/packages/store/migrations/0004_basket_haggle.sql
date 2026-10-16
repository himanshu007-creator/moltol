CREATE TABLE IF NOT EXISTS "baskets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"rounds_max" integer NOT NULL,
	"tone" text NOT NULL,
	"preset" text,
	"state" text DEFAULT 'open' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "negotiation_events_neg_created_idx";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "negotiation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_items" ALTER COLUMN "quantity" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "negotiations" ADD COLUMN "basket_id" uuid;--> statement-breakpoint
ALTER TABLE "negotiations" ADD COLUMN "line_index" integer;--> statement-breakpoint
ALTER TABLE "negotiations" ADD COLUMN "shop_item_id" uuid;--> statement-breakpoint
ALTER TABLE "negotiations" ADD COLUMN "item_emoji" text;--> statement-breakpoint
ALTER TABLE "negotiations" ADD COLUMN "item_unit" text;--> statement-breakpoint
ALTER TABLE "negotiations" ADD COLUMN "qty" numeric(15, 3);--> statement-breakpoint
ALTER TABLE "negotiations" ADD COLUMN "open_cents" integer;--> statement-breakpoint
ALTER TABLE "negotiations" ADD COLUMN "shop_persona" text;--> statement-breakpoint
ALTER TABLE "negotiations" ADD COLUMN "controlled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "basket_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "approve_url" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "persona" text DEFAULT 'charmer' NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "is_open" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "close_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "reopen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_role" text DEFAULT 'buyer' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "haggle_preset" text DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "baskets_buyer_idx" ON "baskets" USING btree ("buyer_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "baskets_shop_idx" ON "baskets" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "negotiations_basket_idx" ON "negotiations" USING btree ("basket_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_basket_idx" ON "payments" USING btree ("basket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_items_shop_idx" ON "shop_items" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "negotiation_events_neg_created_idx" ON "negotiation_events" USING btree ("negotiation_id","created_at");