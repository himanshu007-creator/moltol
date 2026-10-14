import type { MarketRange, Turn } from "@moltol/contracts";
import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * MolTol schema. Money is always integer minor units (cents). Sealed limits live
 * only in `sealed_secrets`, which is never read on the request/prompt path.
 */

export const negotiations = pgTable("negotiations", {
  id: uuid("id").primaryKey().defaultRandom(),
  state: text("state").notNull().default("init"),
  query: text("query").notNull(),
  persona: text("persona").notNull().default("analyst"),
  roundsMax: integer("rounds_max").notNull().default(8),
  maxTotalCents: integer("max_total_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  agreedPriceCents: integer("agreed_price_cents"),
  paypalOrderId: text("paypal_order_id"),
  paypalCaptureId: text("paypal_capture_id"),
  market: jsonb("market").$type<MarketRange | null>(),
  turns: jsonb("turns").$type<Turn[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const negotiationEvents = pgTable(
  "negotiation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    negotiationId: uuid("negotiation_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    audience: text("audience").notNull().default("all"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    negSeq: uniqueIndex("negotiation_events_neg_seq_idx").on(t.negotiationId, t.seq),
    negCreated: uniqueIndex("negotiation_events_neg_created_idx").on(t.negotiationId, t.createdAt),
  }),
);

export const sealedSecrets = pgTable(
  "sealed_secrets",
  {
    negotiationId: uuid("negotiation_id").notNull(),
    side: text("side").notNull(),
    commitment: text("commitment").notNull(),
    /** Plaintext limit, used only when no SEAL_KEY is configured. */
    limitCents: integer("limit_cents"),
    /** AES-256-GCM `iv|tag|ciphertext` (base64) of the limit when SEAL_KEY is set. */
    limitEnc: text("limit_enc"),
    saltHex: text("salt_hex").notNull(),
    domainCents: integer("domain_cents"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.negotiationId, t.side] }),
  }),
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    negotiationId: uuid("negotiation_id").notNull(),
    paypalOrderId: text("paypal_order_id").notNull(),
    paypalCaptureId: text("paypal_capture_id"),
    status: text("status").notNull().default("order_created"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    order: uniqueIndex("payments_order_idx").on(t.paypalOrderId),
    neg: uniqueIndex("payments_neg_idx").on(t.negotiationId),
  }),
);

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull().default("received"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/* --------------------------------- auth ---------------------------------- */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    email: uniqueIndex("users_email_idx").on(t.email),
  }),
);

/** `purpose` keeps a signup-verification code from also being usable to reset a password. */
export const otpCodes = pgTable("otp_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  purpose: text("purpose").notNull().default("signup"),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------- vendor ---------------------------------- */

export const shops = pgTable(
  "shops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    emoji: text("emoji").notNull().default("🏪"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userId: uniqueIndex("shops_user_id_idx").on(t.userId),
  }),
);

export const shopItems = pgTable("shop_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull(),
  name: text("name").notNull(),
  emoji: text("emoji"),
  sellCents: integer("sell_cents").notNull(),
  floorCents: integer("floor_cents").notNull(),
  quantity: integer("quantity"),
  unit: text("unit"),
  hindiName: text("hindi_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const proofs = pgTable(
  "proofs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    negotiationId: uuid("negotiation_id").notNull(),
    priceCents: integer("price_cents").notNull(),
    verified: text("verified").notNull(),
    fairness: integer("fairness").notNull(),
    buyerSavedCents: integer("buyer_saved_cents").notNull(),
    shopGainedCents: integer("shop_gained_cents").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    neg: uniqueIndex("proofs_neg_idx").on(t.negotiationId),
  }),
);
