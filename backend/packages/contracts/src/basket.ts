import { z } from "zod";
import { HagglePresetSchema } from "./auth";
import { CurrencySchema } from "./money";
import { MarketRangeSchema, NegotiationStateSchema, ProofResultSchema } from "./negotiation";

/**
 * A basket: the buyer haggles every line against ONE shop at once. Each line is
 * its own negotiation (own sealed limits, event log, and proof); `lineItemId`
 * IS that negotiation's id, so every event on the basket stream is routed to its
 * lane by `negotiationId`.
 *
 * Per line, the buyer's sealed ceiling is the shop's list price (nobody haggles
 * up from the sticker) and the shop's sealed floor is the vendor's own
 * `floorCents`. The vendor guarantees floor <= list, so every line closes on a
 * price inside [floor, list]: haggling over something already in the basket
 * always lands on a number.
 */

export const HaggleToneSchema = z.enum(["polite", "playful", "firm"]);
export type HaggleTone = z.infer<typeof HaggleToneSchema>;

/** The frontend's NegotiationRequest: rounds = patience, tone = how fast the buyer agent concedes. */
export const HaggleRequestSchema = z.object({
  preset: HagglePresetSchema.optional(),
  rounds: z.number().int().min(2).max(12).default(5),
  tone: HaggleToneSchema.default("playful"),
});
export type HaggleRequest = z.infer<typeof HaggleRequestSchema>;

export const BasketLineInputSchema = z.object({
  itemId: z.string().uuid(),
  qty: z.number().positive().max(10_000),
});

export const CreateBasketSchema = z.object({
  shopId: z.string().uuid(),
  lines: z
    .array(BasketLineInputSchema)
    .min(1)
    .max(12)
    .refine((lines) => new Set(lines.map((l) => l.itemId)).size === lines.length, {
      message: "each item may appear only once",
    }),
  request: HaggleRequestSchema.default({}),
});
export type CreateBasketInput = z.infer<typeof CreateBasketSchema>;

export const BasketLineSchema = z.object({
  /** = the line's negotiationId. */
  lineItemId: z.string().uuid(),
  itemId: z.string().uuid(),
  name: z.string(),
  emoji: z.string().nullable(),
  unit: z.string().nullable(),
  qty: z.number().positive(),
  /** The list price per unit — where the shop opens and the buyer's ceiling. */
  listCents: z.number().int().positive(),
  listLineCents: z.number().int().nonnegative(),
  state: NegotiationStateSchema,
  controlled: z.boolean(),
  /** The shop's standing ask per unit (its last counter, or the list price before it has spoken). */
  askCents: z.number().int().positive(),
  lastBuyerCents: z.number().int().nonnegative().nullable(),
  agreedUnitCents: z.number().int().nonnegative().nullable(),
  agreedLineCents: z.number().int().nonnegative().nullable(),
  market: MarketRangeSchema.nullable(),
});
export type BasketLine = z.infer<typeof BasketLineSchema>;

/**
 * negotiating: at least one line is still haggling. settled: every line has an
 * outcome, ready to check out. payment_pending / paid / failed: the one PayPal
 * order for the whole basket.
 */
export const BasketStateSchema = z.enum([
  "negotiating",
  "settled",
  "payment_pending",
  "paid",
  "failed",
]);
export type BasketState = z.infer<typeof BasketStateSchema>;

export const BasketSchema = z.object({
  id: z.string().uuid(),
  shopId: z.string().uuid(),
  shopName: z.string(),
  shopEmoji: z.string(),
  currency: CurrencySchema,
  state: BasketStateSchema,
  request: z.object({
    rounds: z.number().int(),
    tone: HaggleToneSchema,
    preset: HagglePresetSchema.nullable(),
  }),
  lines: z.array(BasketLineSchema),
  totals: z.object({
    /** Sticker total of the lines that closed. */
    listCents: z.number().int().nonnegative(),
    agreedCents: z.number().int().nonnegative(),
    savedCents: z.number().int().nonnegative(),
    agreedLines: z.number().int().nonnegative(),
    openLines: z.number().int().nonnegative(),
  }),
  paypalOrderId: z.string().nullable(),
  createdAt: z.string(),
});
export type Basket = z.infer<typeof BasketSchema>;

/** POST …/lines/:lineItemId/offer — a human counter, guarded by the buyer's sealed ceiling. */
export const LineOfferSchema = z.object({
  priceCents: z.number().int().positive(),
});
export type LineOffer = z.infer<typeof LineOfferSchema>;

export const LineActionResultSchema = z.object({
  line: BasketLineSchema,
  /** True when this action closed the deal. */
  accepted: z.boolean(),
  /** The shop's new ask when it countered instead. */
  counterCents: z.number().int().positive().nullable(),
});
export type LineActionResult = z.infer<typeof LineActionResultSchema>;

export const AcceptAllResultSchema = z.object({
  agreed: z.array(
    z.object({
      lineItemId: z.string().uuid(),
      unitCents: z.number().int().nonnegative(),
      lineCents: z.number().int().nonnegative(),
    }),
  ),
  basket: BasketSchema,
});
export type AcceptAllResult = z.infer<typeof AcceptAllResultSchema>;

export const BasketCheckoutResultSchema = z.object({
  basketId: z.string().uuid(),
  paypalOrderId: z.string(),
  /** PayPal approval URL; null for the offline mock gateway (capture directly). */
  approveUrl: z.string().nullable(),
  amountCents: z.number().int().positive(),
  currency: CurrencySchema,
});
export type BasketCheckoutResult = z.infer<typeof BasketCheckoutResultSchema>;

export const PaymentStatusSchema = z.enum([
  "order_created",
  "approved",
  "captured",
  "failed",
  "refunded",
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const BasketCaptureResultSchema = z.object({
  basketId: z.string().uuid(),
  status: PaymentStatusSchema,
  captureId: z.string().nullable(),
  proofs: z.array(ProofResultSchema),
});
export type BasketCaptureResult = z.infer<typeof BasketCaptureResultSchema>;

export const OrderLineSchema = z.object({
  lineItemId: z.string().uuid(),
  itemId: z.string().uuid().nullable(),
  title: z.string(),
  emoji: z.string().nullable(),
  unit: z.string().nullable(),
  qty: z.number(),
  /** Agreed per-unit price; null for a line that did not close. */
  unitCents: z.number().int().nullable(),
  lineCents: z.number().int().nullable(),
  listLineCents: z.number().int(),
  noDeal: z.boolean(),
});
export type OrderLine = z.infer<typeof OrderLineSchema>;

/** A checked-out basket, in the frontend's `Order` vocabulary. */
export const OrderSchema = z.object({
  id: z.string().uuid(),
  ts: z.string(),
  shopId: z.string().uuid(),
  shopName: z.string(),
  shopEmoji: z.string(),
  currency: CurrencySchema,
  lines: z.array(OrderLineSchema),
  totalCents: z.number().int().nonnegative(),
  /** Sticker total of the closed lines. */
  listCents: z.number().int().nonnegative(),
  /** Market median × qty of the closed lines (0 when no comps were available). */
  marketCents: z.number().int().nonnegative(),
  savingsCents: z.number().int().nonnegative(),
  /** Mean fairness of the closed lines' proofs; null until the proofs are revealed. */
  fairness: z.number().int().min(0).max(100).nullable(),
  proofVerified: z.boolean(),
  paymentStatus: PaymentStatusSchema,
});
export type Order = z.infer<typeof OrderSchema>;
