import type { Side } from "@moltol/contracts";

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * The guard. Rejects any price that would breach the acting side's sealed limit
 * or the buyer's mandate. Fail closed on anything malformed.
 *
 * This is the single choke point every price must pass before it reaches the wire
 * (AGENTS.md invariant #3).
 */
export function validateOffer(params: {
  side: Side;
  priceCents: number;
  limitCents: number;
  maxTotalCents: number;
}): GuardResult {
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

/** The guard band: an LLM may move the policy price by at most ±bandPct. */
export function clampToBand(policyCents: number, proposedCents: number, bandPct: number): number {
  if (!Number.isFinite(proposedCents)) return policyCents;
  const lo = Math.ceil(policyCents * (1 - bandPct));
  const hi = Math.floor(policyCents * (1 + bandPct));
  if (lo > hi) return policyCents;
  return Math.max(lo, Math.min(hi, Math.round(proposedCents)));
}

export function withinBand(policyCents: number, proposedCents: number, bandPct: number): boolean {
  if (!Number.isFinite(proposedCents)) return false;
  const delta = Math.abs(proposedCents - policyCents);
  return delta <= policyCents * bandPct;
}
