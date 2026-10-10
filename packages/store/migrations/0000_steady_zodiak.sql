CREATE TABLE IF NOT EXISTS "negotiation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negotiation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "negotiations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text DEFAULT 'init' NOT NULL,
	"query" text NOT NULL,
	"persona" text DEFAULT 'analyst' NOT NULL,
	"rounds_max" integer DEFAULT 8 NOT NULL,
	"max_total_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"agreed_price_cents" integer,
	"paypal_order_id" text,
	"paypal_capture_id" text,
	"market" jsonb,
	"turns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negotiation_id" uuid NOT NULL,
	"paypal_order_id" text NOT NULL,
	"paypal_capture_id" text,
	"status" text DEFAULT 'order_created' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negotiation_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"verified" text NOT NULL,
	"fairness" integer NOT NULL,
	"buyer_saved_cents" integer NOT NULL,
	"shop_gained_cents" integer NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sealed_secrets" (
	"negotiation_id" uuid NOT NULL,
	"side" text NOT NULL,
	"commitment" text NOT NULL,
	"limit_cents" integer NOT NULL,
	"salt_hex" text NOT NULL,
	"domain_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sealed_secrets_negotiation_id_side_pk" PRIMARY KEY("negotiation_id","side")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "negotiation_events_neg_seq_idx" ON "negotiation_events" USING btree ("negotiation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "negotiation_events_neg_created_idx" ON "negotiation_events" USING btree ("negotiation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_order_idx" ON "payments" USING btree ("paypal_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_neg_idx" ON "payments" USING btree ("negotiation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proofs_neg_idx" ON "proofs" USING btree ("negotiation_id");