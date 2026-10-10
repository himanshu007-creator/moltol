import type { Side } from "@moltol/contracts";
import { validateOffer, withinBand } from "@moltol/policy";

export interface PriceDecision {
  usedCents: number;
  proposedCents: number;
  ok: boolean;
  reason?: string;
}

/**
 * The guard, made visible. An LLM proposal is accepted only if it is inside the
 * ±band AND passes `validateOffer` for the acting side. Otherwise the policy
 * price is used and the reason is surfaced as a `verdict` event with ok: false.
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
  const rounded = Math.round(proposedCents);
  if (!withinBand(targetCents, rounded, bandPct)) {
    return {
      usedCents: targetCents,
      proposedCents: rounded,
      ok: false,
      reason: `proposal outside guard band (±${(bandPct * 100).toFixed(0)}%); using policy price`,
    };
  }
  const check = validateOffer({ side, priceCents: rounded, limitCents, maxTotalCents });
  if (!check.ok) {
    return { usedCents: targetCents, proposedCents: rounded, ok: false, reason: check.reason };
  }
  return { usedCents: rounded, proposedCents: rounded, ok: true };
}
