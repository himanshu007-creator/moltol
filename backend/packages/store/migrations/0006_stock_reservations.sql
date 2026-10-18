CREATE TABLE IF NOT EXISTS "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"basket_id" uuid NOT NULL,
	"shop_item_id" uuid NOT NULL,
	"qty" numeric(15, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "reserved_qty" numeric(15, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservations_basket_idx" ON "reservations" USING btree ("basket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservations_item_idx" ON "reservations" USING btree ("shop_item_id");