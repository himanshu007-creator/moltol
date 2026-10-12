import { z } from 'zod';

/**
 * The negotiation wire contract — FE_plan.md §5, plan.md §9.2.2.
 * This is the single source of truth shared by the fixture player, the reducer,
 * the UI and (later) the real WebSocket. Money is integer cents.
 */

export const SideSchema = z.enum(['buyer', 'shop']);
export type Side = z.infer<typeof SideSchema>;

export const TurnKindSchema = z.enum(['offer', 'counter', 'accept', 'walkaway']);
export type TurnKind = z.infer<typeof TurnKindSchema>;

/** Tactic vocabulary the UI renders as legible chips (plan.md §9.2.5). */
export const TacticSchema = z.enum([
  'anchor',
  'bundle',
  'free-delivery',
  'walk-away-bluff',
  'loyalty',
  'market-cite',
  'final-offer',
]);
export type Tactic = z.infer<typeof TacticSchema>;

export const MarketSchema = z.object({
  medianCents: z.number().int(),
  p25Cents: z.number().int(),
  p75Cents: z.number().int(),
});
export type Market = z.infer<typeof MarketSchema>;

const sessionStarted = z.object({
  t: z.literal('session.started'),
  negotiationId: z.string(),
  item: z.string(),
  currency: z.string().default('INR'),
  roundsMax: z.number().int().positive(),
  market: MarketSchema,
});

const commitRecorded = z.object({
  t: z.literal('commit.recorded'),
  side: SideSchema,
  commit: z.string(),
});

const turn = z.object({
  t: z.literal('turn'),
  seq: z.number().int().nonnegative(),
  actor: SideSchema,
  kind: TurnKindSchema,
  priceCents: z.number().int().nonnegative().optional(),
  message: z.string(),
  tactic: TacticSchema.optional(),
});

const dealAgreed = z.object({
  t: z.literal('deal.agreed'),
  priceCents: z.number().int().nonnegative(),
});

const paymentStatus = z.object({
  t: z.literal('payment.status'),
  status: z.enum(['order_created', 'approved', 'captured', 'failed']),
  orderId: z.string().optional(),
});

/** Revealed only AFTER settlement — never rendered before (FE_plan §10.2). */
const proofRevealed = z.object({
  t: z.literal('proof.revealed'),
  verified: z.boolean(),
  fairness: z.number().min(0).max(100),
  buyerSavedCents: z.number().int(),
  reveal: z.object({
    buyerLimitCents: z.number().int(),
    buyerSalt: z.string(),
    shopFloorCents: z.number().int(),
    shopSalt: z.string(),
  }),
});

const sessionEnded = z.object({
  t: z.literal('session.ended'),
  reason: z.enum(['deal', 'no_zopa', 'timeout', 'human_cancel']),
});

export const NegotiationEventSchema = z.discriminatedUnion('t', [
  sessionStarted,
  commitRecorded,
  turn,
  dealAgreed,
  paymentStatus,
  proofRevealed,
  sessionEnded,
]);

export type NegotiationEvent = z.infer<typeof NegotiationEventSchema>;
export type SessionStartedEvent = z.infer<typeof sessionStarted>;
export type TurnEvent = z.infer<typeof turn>;
export type ProofRevealedEvent = z.infer<typeof proofRevealed>;
export type SessionEndedEvent = z.infer<typeof sessionEnded>;

/** Parse an untrusted frame (WS or fixture). Throws on invalid — fail closed. */
export function parseEvent(raw: unknown): NegotiationEvent {
  return NegotiationEventSchema.parse(raw);
}
