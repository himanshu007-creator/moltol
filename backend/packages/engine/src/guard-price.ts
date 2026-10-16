import type { Side } from "@moltol/contracts";
import { validateOffer, withinBand } from "@moltol/policy";

export interface PriceDecision {
  usedCents: number;
  proposedCents: number;
  ok: boolean;
  reason?: string;
  /**
   * Why the proposal lost: outside the ±band, or inside it but past this side's
   * sealed limit. Internal only — the public verdict never says which (that, or
   * the rejected number, would bracket the limit).
   */
  rejectedBy?: "band" | "limit";
}

/**
 * Pull a price inside what the guard allows for this side: a buyer never above
 * its ceiling (or mandate), a shop never below its floor (or above its own list
 * price). Policy targets are rounded to whole units, which can land a hair past
 * a non-round limit — this is what keeps the fallback itself legal.
 */
export function clampToGuard(params: {
  side: Side;
  priceCents: number;
  limitCents: number;
  maxTotalCents: number;
}): number {
  const { side, priceCents, limitCents, maxTotalCents } = params;
  const price = Math.round(priceCents);
  if (side === "buyer") return Math.max(0, Math.min(price, limitCents, maxTotalCents));
  return Math.max(limitCents, Math.min(price, maxTotalCents));
}

/**
 * The guard, made visible. An LLM proposal is accepted only if it is inside the
 * ±band AND passes `validateOffer` for the acting side. Otherwise the policy
 * price (clamped to the guard) is used and the reason is surfaced as a
 * `verdict` event with ok: false.
 *
 * `maxTotalCents` is the upper bound for this side's prices: the buyer's
 * mandate for the buyer, the shop's own list price for the shop. It must never
 * be the other side's private number — a shop guarded by the buyer's mandate
 * would announce "exceeds buyer mandate" to the whole stream.
 */
export function decidePrice(params: {
  side: Side;
  targetCents: number;
  proposedCents: number;
  bandPct: number;
  limitCents: number;
  maxTotalCents: number;
}): PriceDecision {
  const { side, targetCents, proposedCents, bandPct, limitCents, maxTotalCents } = params;
  const fallback = clampToGuard({ side, priceCents: targetCents, limitCents, maxTotalCents });
  const rounded = Math.round(proposedCents);
  // What the verdict reports; the event schema wants a non-negative integer.
  const reported = Number.isFinite(rounded) ? Math.max(0, rounded) : 0;
  if (!withinBand(fallback, rounded, bandPct)) {
    return {
      usedCents: fallback,
      proposedCents: reported,
      ok: false,
      reason: `proposal outside guard band (±${(bandPct * 100).toFixed(0)}%); using policy price`,
      rejectedBy: "band",
    };
  }
  const check = validateOffer({ side, priceCents: rounded, limitCents, maxTotalCents });
  if (!check.ok) {
    return {
      usedCents: fallback,
      proposedCents: reported,
      ok: false,
      reason: check.reason,
      rejectedBy: "limit",
    };
  }
  return { usedCents: rounded, proposedCents: rounded, ok: true };
}
