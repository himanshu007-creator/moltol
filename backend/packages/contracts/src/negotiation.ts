import { z } from "zod";
import { CurrencySchema } from "./money";
import { PersonaSchema, SideSchema } from "./common";
import { TurnSchema } from "./turns";

export const MarketRangeSchema = z.object({
  medianCents: z.number().int().nonnegative(),
  p25Cents: z.number().int().nonnegative(),
  p75Cents: z.number().int().nonnegative(),
  sampleCount: z.number().int().nonnegative().default(0),
  source: z.string().default("seed"),
});
export type MarketRange = z.infer<typeof MarketRangeSchema>;

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

/**
 * The one place state transitions are defined. `apps/*` reads this instead of
 * hard-coding `if (state === ...)`. Keyed by current state.
 */
export const STATE_TRANSITIONS: Record<NegotiationState, readonly NegotiationState[]> = {
  init: ["committed", "failed"],
  committed: ["negotiating", "no_deal", "failed"],
  negotiating: ["agreed", "no_deal", "failed"],
  agreed: ["payment_pending", "no_deal", "failed"],
  payment_pending: ["paid", "failed"],
  paid: ["revealed"],
  revealed: [],
  no_deal: [],
  failed: [],
};

export function canTransition(from: NegotiationState, to: NegotiationState): boolean {
  return STATE_TRANSITIONS[from].includes(to);
}

export function mustTransition(from: NegotiationState, to: NegotiationState): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal transition ${from} -> ${to}`);
  }
}

export const CreateNegotiationSchema = z.object({
  query: z.string().min(1).max(200),
  persona: PersonaSchema.default("analyst"),
  maxTotalCents: z.number().int().positive(),
  currency: CurrencySchema.default("USD"),
  roundsMax: z.number().int().min(2).max(20).default(8),
});
export type CreateNegotiationInput = z.infer<typeof CreateNegotiationSchema>;

export const NegotiationSchema = z.object({
  id: z.string().uuid(),
  state: NegotiationStateSchema,
  query: z.string(),
  persona: PersonaSchema,
  roundsMax: z.number().int().positive(),
  maxTotalCents: z.number().int().positive(),
  currency: CurrencySchema,
  agreedPriceCents: z.number().int().nonnegative().nullable(),
  paypalOrderId: z.string().nullable(),
  paypalCaptureId: z.string().nullable(),
  market: MarketRangeSchema.nullable(),
  turns: z.array(TurnSchema),
  createdAt: z.string(),
});
export type Negotiation = z.infer<typeof NegotiationSchema>;

/** Request body for POST /v1/negotiations/:id/checkout (buyer-approved amount). */
export const CheckoutInputSchema = z.object({
  origin: z.string().url().optional(),
});
export type CheckoutInput = z.infer<typeof CheckoutInputSchema>;

export const CheckoutResultSchema = z.object({
  negotiationId: z.string().uuid(),
  paypalOrderId: z.string(),
  approveUrl: z.string().nullable(),
  amountCents: z.number().int().nonnegative(),
  currency: CurrencySchema,
});
export type CheckoutResult = z.infer<typeof CheckoutResultSchema>;

export const ProofResultSchema = z.object({
  negotiationId: z.string().uuid(),
  verified: z.boolean(),
  fairness: z.number().min(0).max(100),
  buyerSavedCents: z.number().int(),
  shopGainedCents: z.number().int(),
  priceCents: z.number().int().nonnegative(),
  buyerCommit: z.string(),
  shopCommit: z.string(),
  reasons: z.array(z.string()),
});
export type ProofResult = z.infer<typeof ProofResultSchema>;

/** A sealed side limit, as held by the vault. Never sent to an LLM or the wire. */
export const SealedLimitSchema = z.object({
  negotiationId: z.string().uuid(),
  side: SideSchema,
  commitment: z.string(),
  limitCents: z.number().int().nonnegative(),
});
export type SealedLimit = z.infer<typeof SealedLimitSchema>;
