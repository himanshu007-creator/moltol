import { fairnessScore } from "./concessions";
import { verifyReveal } from "./crypto";

/**
 * Proof of Fair Deal: both sealed limits are revealed and checked against the
 * commitments published before the first turn, and against the settled price.
 * Returns everything the UI needs to show the deal was honest.
 */
export function verifyFairDeal(params: {
  negotiationId: string;
  currency: string;
  priceCents: number;
  buyer: { commitment: string; maxCents: number; salt: Uint8Array };
  shop: { commitment: string; floorCents: number; salt: Uint8Array };
}): {
  verified: boolean;
  fairness: number;
  buyerSavedCents: number;
  shopGainedCents: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  const buyerOk = verifyReveal(
    params.buyer.commitment,
    {
      negotiationId: params.negotiationId,
      side: "buyer",
      currency: params.currency,
      limitCents: params.buyer.maxCents,
    },
    params.buyer.salt,
  );
  const shopOk = verifyReveal(
    params.shop.commitment,
    {
      negotiationId: params.negotiationId,
      side: "shop",
      currency: params.currency,
      limitCents: params.shop.floorCents,
    },
    params.shop.salt,
  );

  if (!buyerOk) reasons.push("buyer commitment did not verify");
  if (!shopOk) reasons.push("shop commitment did not verify");
  if (params.shop.floorCents > params.priceCents) reasons.push("price breached shop floor");
  if (params.priceCents > params.buyer.maxCents) reasons.push("price breached buyer max");

  return {
    verified: reasons.length === 0,
    fairness: fairnessScore(params.priceCents, params.shop.floorCents, params.buyer.maxCents),
    buyerSavedCents: Math.max(0, params.buyer.maxCents - params.priceCents),
    shopGainedCents: Math.max(0, params.priceCents - params.shop.floorCents),
    reasons,
  };
}
