import { PRICE_ROUNDING_CENTS } from "@moltol/config";

/**
 * Deterministic negotiation policy. Pure functions only — the LLM never sets a
 * price here. See plan sections 9.2.4 / 9.2.5.
 */

/** Persona concession exponent beta. Boulware < 1 holds late; Conceder > 1 gives early. */
export const PERSONA_BETA: Record<string, number> = {
  charmer: 1.4,
  stoic: 0.4,
  storyteller: 0.9,
  analyst: 0.6,
};

export interface ConcessionInput {
  openCents: number;
  limitCents: number;
  t: number;
  T: number;
  beta: number;
}

export function roundToWholeDollars(cents: number): number {
  return Math.round(cents / PRICE_ROUNDING_CENTS) * PRICE_ROUNDING_CENTS;
}

/**
 * Time-dependent concession (Boulware/Conceder family):
 *   buyer rises from open toward limit; shop falls from open toward limit.
 * The direction is inferred from whether limit > open (buyer) or < (shop).
 */
export function concession(input: ConcessionInput): number {
  const { openCents, limitCents, t, T, beta } = input;
  const lo = Math.min(openCents, limitCents);
  const hi = Math.max(openCents, limitCents);
  if (T <= 0) return Math.max(lo, Math.min(hi, roundToWholeDollars(limitCents)));
  const clampedT = Math.max(0, Math.min(t, T));
  const progress = Math.pow(clampedT / T, 1 / Math.max(beta, 0.0001));
  const raw = openCents + (limitCents - openCents) * progress;
  return Math.max(lo, Math.min(hi, roundToWholeDollars(raw)));
}

/** Final round: a side meets the counterparty if it is within its own limit. */
export function finalRoundOffer(limitCents: number): number {
  return roundToWholeDollars(limitCents);
}

/** Acceptance rule: accept an incoming price no worse than your own next offer. */
export function shouldAccept(params: {
  side: "buyer" | "shop";
  incomingCents: number;
  myNextOfferCents: number;
  myLimitCents: number;
}): boolean {
  const { side, incomingCents, myNextOfferCents, myLimitCents } = params;
  if (side === "buyer") {
    return incomingCents <= myNextOfferCents && incomingCents <= myLimitCents;
  }
  return incomingCents >= myNextOfferCents && incomingCents >= myLimitCents;
}

/** Buyer opening anchor from market comps, clamped below the mandate. */
export function openingAnchor(params: {
  p25Cents: number;
  maxTotalCents: number;
  factor?: number;
}): number {
  const factor = params.factor ?? 0.85;
  const raw = roundToWholeDollars(params.p25Cents * factor);
  const lower = Math.max(100, roundToWholeDollars(params.maxTotalCents * 0.5));
  return Math.min(params.maxTotalCents, Math.max(lower, Math.min(raw, params.maxTotalCents)));
}

/** Share of surplus to the buyer: f = (P - Rs) / (Rb - Rs). */
export function buyerSurplusShare(
  priceCents: number,
  floorCents: number,
  maxCents: number,
): number {
  const span = maxCents - floorCents;
  if (span <= 0) return 0.5;
  return (priceCents - floorCents) / span;
}

/** Displayed fairness: 100 means an even split of the surplus. */
export function fairnessScore(priceCents: number, floorCents: number, maxCents: number): number {
  const f = buyerSurplusShare(priceCents, floorCents, maxCents);
  return Math.round((1 - Math.abs(2 * f - 1)) * 100);
}
