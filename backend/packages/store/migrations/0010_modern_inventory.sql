CREATE TABLE IF NOT EXISTS "stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_item_id" uuid NOT NULL,
	"delta" numeric(15, 3) NOT NULL,
	"reason" text,
	"op_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "cost_cents" integer;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "low_stock_at" numeric(15, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "custom_unit" text;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "pack_size" numeric(15, 3);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_adjustments_item_idx" ON "stock_adjustments" USING btree ("shop_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_adjustments_op_idx" ON "stock_adjustments" USING btree ("shop_item_id","op_id");