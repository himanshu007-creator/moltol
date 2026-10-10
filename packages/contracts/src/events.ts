import { z } from "zod";
import { AudienceSchema, SideSchema } from "./common";
import { TurnSchema } from "./turns";
import { MarketRangeSchema } from "./negotiation";
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
    proposedCents: z.number().int().nonnegative(),
    usedCents: z.number().int().nonnegative(),
    reason: z.string().optional(),
  }),
  envelope({
    t: z.literal("deal.agreed"),
    priceCents: z.number().int().nonnegative(),
    currency: CurrencySchema,
    fairness: z.number().min(0).max(100),
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
  }),
  envelope({
    t: z.literal("session.ended"),
    reason: z.enum(["deal", "no_zopa", "timeout", "human_cancel", "error"]),
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
