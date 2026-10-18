ALTER TABLE "payments" ADD COLUMN "deal_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "deal_currency" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "fx_rate" numeric(18, 8);