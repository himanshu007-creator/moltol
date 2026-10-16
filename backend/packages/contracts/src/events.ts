import { z } from "zod";
import { AudienceSchema, SideSchema } from "./common";
import { TurnSchema } from "./turns";
import { MarketRangeSchema, RevealSchema } from "./negotiation";
import { CurrencySchema } from "./money";

/**
 * Every event on the wire is wrapped in this envelope. `seq` is monotonic per
 * negotiation; `audience` gates SSE delivery; `v` lets the frontend version.
 */
const envelopeShape = {
  v: z.literal(1),
  id: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  negotiationId: z.string().uuid(),
  ts: z.string(),
  audience: AudienceSchema.default("all"),
};

function envelope<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...envelopeShape, ...shape });
}

export const NegotiationEventSchema = z.discriminatedUnion("t", [
  envelope({
    t: z.literal("session.started"),
    roundsMax: z.number().int().positive(),
    persona: z.string(),
    market: MarketRangeSchema,
  }),
  envelope({
    t: z.literal("limits.sealed"),
    buyerCommit: z.string(),
    shopCommit: z.string(),
  }),
  envelope({ t: z.literal("turn"), turn: TurnSchema }),
  envelope({
    t: z.literal("verdict"),
    actor: SideSchema,
    turnSeq: z.number().int().nonnegative(),
    ok: z.boolean(),
    bandPct: z.number().nonnegative(),
    /**
     * Only on an accepted proposal (then equal to usedCents). A rejected number is
     * never published: one rejected for crossing a sealed limit (not the band)
     * would bracket that limit. Optional so older logged events still parse.
     */
    proposedCents: z.number().int().nonnegative().optional(),
    usedCents: z.number().int().nonnegative(),
    reason: z.string().optional(),
  }),
  envelope({
    t: z.literal("deal.agreed"),
    priceCents: z.number().int().nonnegative(),
    currency: CurrencySchema,
    /**
     * Not sent any more: fairness is a function of BOTH sealed limits, so with
     * the price and its own limit either side could solve for the other's limit
     * before settlement. It arrives with `proof.revealed`. Kept optional so older
     * logged events still parse.
     */
    fairness: z.number().min(0).max(100).optional(),
  }),
  envelope({
    t: z.literal("payment.status"),
    status: z.enum(["order_created", "approved", "captured", "failed", "refunded"]),
    paypalOrderId: z.string().optional(),
    paypalCaptureId: z.string().optional(),
  }),
  envelope({
    t: z.literal("proof.revealed"),
    verified: z.boolean(),
    fairness: z.number().min(0).max(100),
    buyerSavedCents: z.number().int(),
    reasons: z.array(z.string()),
    /** Emitted only after payment is captured. Optional only for events logged before it existed. */
    reveal: RevealSchema.optional(),
  }),
  envelope({
    t: z.literal("session.ended"),
    reason: z.enum(["deal", "no_zopa", "timeout", "human_cancel", "error"]),
  }),
  /** Who drives the buyer side from here on. "human" = the buyer took the lane over. */
  envelope({
    t: z.literal("control.changed"),
    controller: z.enum(["agent", "human"]),
  }),
  envelope({
    t: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);

export type NegotiationEvent = z.infer<typeof NegotiationEventSchema>;
export type EventType = NegotiationEvent["t"];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Event body without the transport envelope (what a producer supplies). */
export type EventInput = DistributiveOmit<NegotiationEvent, keyof typeof envelopeShape>;
