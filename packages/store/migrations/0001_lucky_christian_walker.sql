ALTER TABLE "sealed_secrets" ALTER COLUMN "limit_cents" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sealed_secrets" ADD COLUMN "limit_enc" text;