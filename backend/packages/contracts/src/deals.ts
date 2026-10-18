import { z } from "zod";
import { CurrencySchema } from "./money";
import type { NegotiationEvent } from "./events";

/**
 * The seller's own live deal feed: one shop, private to its owner. Rides the
 * same SSE pattern as the stall map, on a per-shop Redis channel, because the
 * seller dashboard needs to alert (sound/haptic) the moment a new offer lands
 * or a lane closes — not poll.
 */

const base = {
  shopId: z.string().uuid(),
  basketId: z.string().uuid(),
  ts: z.string(),
};

export const DealFeedEventSchema = z.discriminatedUnion("t", [
  z.object({
    ...base,
    t: z.literal("deal.incoming"),
    currency: CurrencySchema,
    totalCents: z.number().int().nonnegative(),
    lines: z.array(
      z.object({
        name: z.string(),
        qty: z.number(),
        unit: z.string().nullable(),
        listCents: z.number().int().nonnegative(),
      }),
    ),
  }),
  z.object({
    ...base,
    t: z.literal("deal.closed"),
    lineItemId: z.string().uuid(),
    name: z.string(),
    won: z.boolean(),
    unitCents: z.number().int().nonnegative().nullable(),
    currency: CurrencySchema,
  }),
]);
export type DealFeedEvent = z.infer<typeof DealFeedEventSchema>;

/**
 * Map a committed negotiation event to a seller deal frame, if it closes a lane.
 * Pure: the caller supplies the shop id (looked up from the negotiation's basket).
 */
export function dealClosedFromEvent(
  event: NegotiationEvent,
  shopId: string,
  basketId: string,
  name: string,
  currency: string,
): DealFeedEvent | null {
  if (event.t === "deal.agreed") {
    return {
      t: "deal.closed",
      shopId,
      basketId,
      lineItemId: event.negotiationId,
      name,
      won: true,
      unitCents: event.priceCents,
      currency: event.currency,
      ts: event.ts,
    };
  }
  if (event.t === "session.ended" && (event.reason === "no_zopa" || event.reason === "timeout")) {
    return {
      t: "deal.closed",
      shopId,
      basketId,
      lineItemId: event.negotiationId,
      name,
      won: false,
      unitCents: null,
      currency,
      ts: event.ts,
    };
  }
  return null;
}
