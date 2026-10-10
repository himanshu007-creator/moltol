import { z } from "zod";

/** ISO-4217 currency code, uppercase. */
export const CurrencySchema = z.string().length(3).transform((c) => c.toUpperCase());

/**
 * Money is always carried as an integer count of minor units (cents) plus a
 * currency. Never floats. See plan section 10 ("Money as integers").
 */
export const MoneySchema = z.object({
  amountCents: z.number().int().nonnegative(),
  currency: CurrencySchema.default("USD"),
});
export type Money = z.infer<typeof MoneySchema>;

export const SideSchema = z.enum(["buyer", "shop"]);
export type Side = z.infer<typeof SideSchema>;

export const OfferKindSchema = z.enum(["offer", "counter", "accept", "walkaway"]);
export type OfferKind = z.infer<typeof OfferKindSchema>;

export const TacticSchema = z.enum([
  "anchor",
  "bundle",
  "free-delivery",
  "walk-away-bluff",
  "loyalty",
  "market-cite",
  "final-offer",
  "plain",
]);
export type Tactic = z.infer<typeof TacticSchema>;

/** A single negotiation turn. Append-only in the store. */
export const TurnSchema = z.object({
  seq: z.number().int().nonnegative(),
  actor: SideSchema,
  kind: OfferKindSchema,
  priceCents: z.number().int().nonnegative().optional(),
  message: z.string().max(500),
  tactic: TacticSchema.optional(),
});
export type Turn = z.infer<typeof TurnSchema>;

export const MarketRangeSchema = z.object({
  medianCents: z.number().int().nonnegative(),
  p25Cents: z.number().int().nonnegative(),
  p75Cents: z.number().int().nonnegative(),
  sampleCount: z.number().int().nonnegative().default(0),
});
export type MarketRange = z.infer<typeof MarketRangeSchema>;

/** WebSocket / SSE event contract (shared by FE and BE). */
export const NegotiationEventSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("session.started"),
    negotiationId: z.string(),
    roundsMax: z.number().int().positive(),
    market: MarketRangeSchema,
  }),
  z.object({
    t: z.literal("commit.recorded"),
    side: SideSchema,
    commit: z.string(),
  }),
  z.object({ t: z.literal("turn"), turn: TurnSchema }),
  z.object({ t: z.literal("deal.agreed"), priceCents: z.number().int().nonnegative() }),
  z.object({
    t: z.literal("payment.status"),
    status: z.enum(["order_created", "approved", "captured", "failed"]),
    paypalOrderId: z.string().optional(),
  }),
  z.object({
    t: z.literal("proof.revealed"),
    verified: z.boolean(),
    fairness: z.number().min(0).max(100),
    buyerSavedCents: z.number().int(),
  }),
  z.object({
    t: z.literal("session.ended"),
    reason: z.enum(["deal", "no_zopa", "timeout", "human_cancel"]),
  }),
]);
export type NegotiationEvent = z.infer<typeof NegotiationEventSchema>;

export const PersonaSchema = z.enum(["charmer", "stoic", "storyteller", "analyst"]);
export type Persona = z.infer<typeof PersonaSchema>;

export const CreateNegotiationSchema = z.object({
  query: z.string().min(1).max(200),
  persona: PersonaSchema.default("analyst"),
  maxTotalCents: z.number().int().positive(),
  currency: CurrencySchema.default("USD"),
  roundsMax: z.number().int().min(2).max(20).default(8),
});
export type CreateNegotiationInput = z.infer<typeof CreateNegotiationSchema>;

export const NegotiationStateSchema = z.enum([
  "init",
  "committed",
  "negotiating",
  "agreed",
  "payment_pending",
  "paid",
  "revealed",
  "no_deal",
  "failed",
]);
export type NegotiationState = z.infer<typeof NegotiationStateSchema>;

export const NegotiationSchema = z.object({
  id: z.string(),
  state: NegotiationStateSchema,
  query: z.string(),
  persona: PersonaSchema,
  roundsMax: z.number().int().positive(),
  maxTotalCents: z.number().int().positive(),
  currency: CurrencySchema,
  agreedPriceCents: z.number().int().nonnegative().nullable(),
  paypalOrderId: z.string().nullable(),
  market: MarketRangeSchema.nullable(),
  turns: z.array(TurnSchema),
  createdAt: z.string(),
});
export type Negotiation = z.infer<typeof NegotiationSchema>;
