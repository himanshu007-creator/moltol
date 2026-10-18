import { z } from 'zod';

/**
 * The negotiation wire contract — mirrors the backend's exactly
 * (`backend/packages/contracts/src/events.ts`), since that's the only one of
 * the two schemas ever exercised against a real server. Money is integer
 * cents. This is the single source of truth shared by the local simulation
 * (`lib/mock/seeds.ts`'s `buildCartScript`, which emits these same shapes),
 * the reducer, the UI, and the real SSE stream (`lib/basketStream.ts`).
 */

export const SideSchema = z.enum(['buyer', 'shop']);
export type Side = z.infer<typeof SideSchema>;

export const OfferKindSchema = z.enum(['offer', 'counter', 'accept', 'walkaway']);
export type TurnKind = z.infer<typeof OfferKindSchema>;

export const TacticSchema = z.enum([
  'anchor',
  'bundle',
  'free-delivery',
  'walk-away-bluff',
  'loyalty',
  'market-cite',
  'final-offer',
  'plain',
]);
export type Tactic = z.infer<typeof TacticSchema>;

export const AudienceSchema = z.enum(['all', 'buyer', 'shop', 'platform']);
export type Audience = z.infer<typeof AudienceSchema>;

export const MarketSchema = z.object({
  medianCents: z.number().int(),
  p25Cents: z.number().int(),
  p75Cents: z.number().int(),
  sampleCount: z.number().int().default(0),
  source: z.string().default('seed'),
});
export type Market = z.infer<typeof MarketSchema>;

export const TurnSchema = z.object({
  seq: z.number().int().nonnegative(),
  actor: SideSchema,
  kind: OfferKindSchema,
  priceCents: z.number().int().nonnegative().optional(),
  message: z.string(),
  tactic: TacticSchema.optional(),
});
export type TurnEvent = z.infer<typeof TurnSchema>;

export const RevealSchema = z.object({
  buyerLimitCents: z.number().int().nonnegative(),
  buyerSalt: z.string(),
  shopFloorCents: z.number().int().nonnegative(),
  shopSalt: z.string(),
});
export type Reveal = z.infer<typeof RevealSchema>;

const envelopeShape = {
  v: z.literal(1),
  id: z.string(),
  seq: z.number().int().nonnegative(),
  negotiationId: z.string(),
  ts: z.string(),
  audience: AudienceSchema.default('all'),
};

function envelope<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...envelopeShape, ...shape });
}

export const NegotiationEventSchema = z.discriminatedUnion('t', [
  envelope({
    t: z.literal('session.started'),
    roundsMax: z.number().int().positive(),
    persona: z.string(),
    market: MarketSchema,
  }),
  envelope({
    t: z.literal('limits.sealed'),
    buyerCommit: z.string(),
    shopCommit: z.string(),
  }),
  envelope({ t: z.literal('turn'), turn: TurnSchema }),
  envelope({
    t: z.literal('verdict'),
    actor: SideSchema,
    turnSeq: z.number().int().nonnegative(),
    ok: z.boolean(),
    bandPct: z.number().nonnegative(),
    proposedCents: z.number().int().nonnegative().optional(),
    usedCents: z.number().int().nonnegative(),
    reason: z.string().optional(),
  }),
  envelope({
    t: z.literal('deal.agreed'),
    priceCents: z.number().int().nonnegative(),
    currency: z.string().default('INR'),
  }),
  envelope({
    t: z.literal('payment.status'),
    status: z.enum(['order_created', 'approved', 'captured', 'failed', 'refunded']),
    paypalOrderId: z.string().optional(),
    paypalCaptureId: z.string().optional(),
  }),
  envelope({
    t: z.literal('proof.revealed'),
    verified: z.boolean(),
    fairness: z.number().min(0).max(100),
    buyerSavedCents: z.number().int(),
    reasons: z.array(z.string()).default([]),
    reveal: RevealSchema.optional(),
  }),
  envelope({
    t: z.literal('session.ended'),
    reason: z.enum(['deal', 'no_zopa', 'timeout', 'human_cancel', 'error']),
  }),
  /** Who drives the buyer side from here on. "human" = the buyer took the lane over. */
  envelope({
    t: z.literal('control.changed'),
    controller: z.enum(['agent', 'human']),
  }),
  envelope({
    t: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
]);

export type NegotiationEvent = z.infer<typeof NegotiationEventSchema>;

/** Parse an untrusted frame (SSE or local script). Throws on invalid — fail closed. */
export function parseEvent(raw: unknown): NegotiationEvent {
  return NegotiationEventSchema.parse(raw);
}
