import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Side } from "@moltol/contracts";

/**
 * Deterministic negotiation policy.
 *
 * "The LLM proposes, policy disposes." Every price is produced here, never by
 * the model. These functions are pure (except `commit`/`verifyReveal`, which are
 * deterministic crypto) so they are trivially unit-testable.
 *
 * See plan sections 9.2.4 and 9.2.5.
 */

/** Persona concession exponent beta. Boulware < 1 holds late; Conceder > 1 gives early. */
export const PERSONA_BETA: Record<string, number> = {
  charmer: 1.4,
  stoic: 0.4,
  storyteller: 0.9,
  analyst: 0.6,
};

export interface ConcessionInput {
  /** Opening price for this side (buyer anchor or shop list price). */
  openCents: number;
  /** Hard limit for this side: buyer max (Rb) or shop floor (Rs). */
  limitCents: number;
  /** Current round, 0-indexed. */
  t: number;
  /** Total rounds (T). Must be >= 1. */
  T: number;
  /** Persona exponent. */
  beta: number;
}

/**
 * Time-dependent concession (Boulware/Conceder family), plan 9.2.4:
 *   buyer: open + (limit - open) * (t/T)^(1/beta)     (rising)
 *   shop:  open - (open - limit) * (t/T)^(1/beta)     (falling)
 * The sign is inferred from whether limit > open (buyer) or limit < open (shop).
 */
export function concession(input: ConcessionInput): number {
  const { openCents, limitCents, t, T, beta } = input;
  if (T <= 0) return limitCents;
  const clampedT = Math.max(0, Math.min(t, T));
  const progress = Math.pow(clampedT / T, 1 / Math.max(beta, 0.0001));
  const next = openCents + (limitCents - openCents) * progress;
  return Math.round(next / 100) * 100;
}

/**
 * Acceptance rule (plan 9.2.4): a side accepts an incoming price if it is no
 * worse than the price that side would have offered next round, and it respects
 * the side's own hard limit.
 */
export function shouldAccept(params: {
  side: Side;
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

/**
 * Guard: reject any price that would breach the side's sealed limit or the
 * buyer's mandate. Fail closed on anything malformed.
 */
export function validateOffer(params: {
  side: Side;
  priceCents: number;
  limitCents: number;
  maxTotalCents: number;
}): { ok: true } | { ok: false; reason: string } {
  const { side, priceCents, limitCents, maxTotalCents } = params;
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    return { ok: false, reason: "price must be a non-negative integer (cents)" };
  }
  if (priceCents > maxTotalCents) {
    return { ok: false, reason: "price exceeds buyer mandate (maxTotalCents)" };
  }
  if (side === "buyer" && priceCents > limitCents) {
    return { ok: false, reason: "buyer price exceeds sealed max (would overpay)" };
  }
  if (side === "shop" && priceCents < limitCents) {
    return { ok: false, reason: "shop price below sealed floor (would undersell)" };
  }
  return { ok: true };
}

/** Buyer opening anchor from market comps, clamped below the mandate. */
export function openingAnchor(params: {
  p25Cents: number;
  maxTotalCents: number;
  factor?: number;
}): number {
  const factor = params.factor ?? 0.85;
  const raw = Math.round((params.p25Cents * factor) / 100) * 100;
  const lower = Math.max(100, Math.round(params.maxTotalCents * 0.5));
  return Math.max(lower, Math.min(raw, params.maxTotalCents));
}

/** Share of surplus to the buyer: f = (P - Rs) / (Rb - Rs). */
export function buyerSurplusShare(priceCents: number, floorCents: number, maxCents: number): number {
  const span = maxCents - floorCents;
  if (span <= 0) return 0.5;
  return (priceCents - floorCents) / span;
}

/** Displayed fairness: 100 means an even split of the surplus. */
export function fairnessScore(priceCents: number, floorCents: number, maxCents: number): number {
  const f = buyerSurplusShare(priceCents, floorCents, maxCents);
  return Math.round((1 - Math.abs(2 * f - 1)) * 100);
}

/* ----------------------------- Commit / reveal ---------------------------- */

function commitBytes(limitCents: number, salt: Uint8Array): string {
  const h = createHash("sha256");
  h.update(String(limitCents));
  h.update(Buffer.from(salt));
  return h.digest("hex");
}

/** H(limit || salt). Deterministic and safe to publish before the reveal. */
export function commit(limitCents: number, salt: Uint8Array): string {
  return commitBytes(limitCents, salt);
}

export function newSalt(): Uint8Array {
  return randomBytes(16);
}

/** Verify a reveal against a previously published commitment. */
export function verifyReveal(commitment: string, limitCents: number, salt: Uint8Array): boolean {
  const recomputed = commitBytes(limitCents, salt);
  const a = Buffer.from(commitment, "hex");
  const b = Buffer.from(recomputed, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Full fairness proof: hashes verify AND floor <= price <= max. */
export function verifyProofOfFairDeal(params: {
  buyerCommit: string;
  buyerMaxCents: number;
  buyerSalt: Uint8Array;
  shopCommit: string;
  shopFloorCents: number;
  shopSalt: Uint8Array;
  priceCents: number;
}): { verified: boolean; fairness: number; buyerSavedCents: number; reasons: string[] } {
  const reasons: string[] = [];
  const buyerOk = verifyReveal(params.buyerCommit, params.buyerMaxCents, params.buyerSalt);
  const shopOk = verifyReveal(params.shopCommit, params.shopFloorCents, params.shopSalt);
  if (!buyerOk) reasons.push("buyer commitment did not verify");
  if (!shopOk) reasons.push("shop commitment did not verify");
  if (params.shopFloorCents > params.priceCents) reasons.push("price breached shop floor");
  if (params.priceCents > params.buyerMaxCents) reasons.push("price breached buyer max");
  return {
    verified: reasons.length === 0,
    fairness: fairnessScore(params.priceCents, params.shopFloorCents, params.buyerMaxCents),
    buyerSavedCents: Math.max(0, params.buyerMaxCents - params.priceCents),
    reasons,
  };
}
