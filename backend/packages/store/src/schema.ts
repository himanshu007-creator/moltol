import type { MarketRange, Turn } from "@moltol/contracts";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
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
 * Quantities (not money) are `numeric(15,3)` so 0.25 kg stays exact (and any old integer stock fits).
 */

export const negotiations = pgTable(
  "negotiations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    state: text("state").notNull().default("init"),
    query: text("query").notNull(),
    persona: text("persona").notNull().default("analyst"),
    roundsMax: integer("rounds_max").notNull().default(8),
    /** The buyer's mandate. For a basket line this is the per-unit ceiling. */
    maxTotalCents: integer("max_total_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    agreedPriceCents: integer("agreed_price_cents"),
    paypalOrderId: text("paypal_order_id"),
    paypalCaptureId: text("paypal_capture_id"),
    market: jsonb("market").$type<MarketRange | null>(),
    turns: jsonb("turns").$type<Turn[]>().notNull().default([]),
    /* Basket lines only (null for a standalone negotiation). */
    basketId: uuid("basket_id"),
    lineIndex: integer("line_index"),
    shopItemId: uuid("shop_item_id"),
    /** Snapshots, so an order still reads right after the vendor edits or deletes the item. */
    itemEmoji: text("item_emoji"),
    itemUnit: text("item_unit"),
    qty: numeric("qty", { precision: 15, scale: 3 }),
    /** The shop's public opening (list) price per unit; its floor lives only in the vault. */
    openCents: integer("open_cents"),
    shopPersona: text("shop_persona"),
    /** A human has taken the buyer's side over; the agent runner must not move. */
    controlled: boolean("controlled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    basket: index("negotiations_basket_idx").on(t.basketId),
  }),
);

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
    // Not unique: two events of one negotiation may share a timestamp (one
    // transaction). Uniqueness is (negotiation_id, seq) alone.
    negCreated: index("negotiation_events_neg_created_idx").on(t.negotiationId, t.createdAt),
  }),
);

/** A buyer's basket haggled against one shop: one negotiation per line. */
export const baskets = pgTable(
  "baskets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buyerUserId: uuid("buyer_user_id").notNull(),
    shopId: uuid("shop_id").notNull(),
    currency: text("currency").notNull(),
    roundsMax: integer("rounds_max").notNull(),
    tone: text("tone").notNull(),
    preset: text("preset"),
    /** open -> payment_pending -> paid (or failed). Line outcomes live on the lines. */
    state: text("state").notNull().default("open"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    buyer: index("baskets_buyer_idx").on(t.buyerUserId),
    shop: index("baskets_shop_idx").on(t.shopId),
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

/** One PayPal order per standalone negotiation OR per basket (exactly one is set). */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    negotiationId: uuid("negotiation_id"),
    basketId: uuid("basket_id"),
    paypalOrderId: text("paypal_order_id").notNull(),
    paypalCaptureId: text("paypal_capture_id"),
    /** Kept so a buyer who reloads mid-checkout can still reach PayPal's approval page. */
    approveUrl: text("approve_url"),
    status: text("status").notNull().default("order_created"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    order: uniqueIndex("payments_order_idx").on(t.paypalOrderId),
    neg: uniqueIndex("payments_neg_idx").on(t.negotiationId),
    basket: uniqueIndex("payments_basket_idx").on(t.basketId),
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
    /** Bumped on password reset: every token carrying an older version is rejected. */
    tokenVersion: integer("token_version").notNull().default(0),
    /** Which side of the dual-role account the user last chose. A view preference only. */
    activeRole: text("active_role").notNull().default("buyer"),
    /** Saved default haggle style (quick | balanced | hard). */
    hagglePreset: text("haggle_preset").notNull().default("balanced"),
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
    /** The shop agent's haggle style; sets how fast it concedes. */
    persona: text("persona").notNull().default("charmer"),
    currency: text("currency").notNull().default("INR"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    /** Stall status. A due closeAt/reopenAt flips `isOpen` on read (see shopStatus). */
    isOpen: boolean("is_open").notNull().default(true),
    closeAt: timestamp("close_at", { withTimezone: true }),
    reopenAt: timestamp("reopen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userId: uniqueIndex("shops_user_id_idx").on(t.userId),
  }),
);

export const shopItems = pgTable(
  "shop_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id").notNull(),
    name: text("name").notNull(),
    emoji: text("emoji"),
    sellCents: integer("sell_cents").notNull(),
    /** The vendor's floor. Copied into the sealed vault when a negotiation starts. */
    floorCents: integer("floor_cents").notNull(),
    /** Stock in `unit`; null = not tracked. */
    quantity: numeric("quantity", { precision: 15, scale: 3 }),
    unit: text("unit"),
    hindiName: text("hindi_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shop: index("shop_items_shop_idx").on(t.shopId),
  }),
);

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
