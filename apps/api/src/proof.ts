import type { NegotiationEvent, ProofResult } from "@moltol/contracts";
import { fromHex, verifyFairDeal } from "@moltol/policy";
import type { MoltolStore } from "@moltol/store";

/**
 * Reveal both sealed limits, verify them against the pre-negotiation commitments,
 * persist the proof, and emit a `proof.revealed` event. Idempotent.
 */
export async function revealProof(
  store: MoltolStore,
  negotiationId: string,
  onEvent?: (event: NegotiationEvent) => Promise<void>,
): Promise<ProofResult | null> {
  const n = await store.getNegotiation(negotiationId);
  if (!n || n.agreedPriceCents === null) return null;
  const buyer = await store.getSealed(negotiationId, "buyer");
  const shop = await store.getSealed(negotiationId, "shop");
  if (!buyer || !shop) return null;

  const result = verifyFairDeal({
    negotiationId,
    currency: n.currency,
    priceCents: n.agreedPriceCents,
    buyer: {
      commitment: buyer.commitment,
      maxCents: buyer.limitCents,
      salt: fromHex(buyer.saltHex),
    },
    shop: { commitment: shop.commitment, floorCents: shop.limitCents, salt: fromHex(shop.saltHex) },
  });

  await store.upsertProof({
    negotiationId,
    priceCents: n.agreedPriceCents,
    verified: result.verified,
    fairness: result.fairness,
    buyerSavedCents: result.buyerSavedCents,
    shopGainedCents: result.shopGainedCents,
    detail: {
      buyerCommit: buyer.commitment,
      shopCommit: shop.commitment,
      reasons: result.reasons,
    },
  });

  const proof: ProofResult = {
    negotiationId,
    verified: result.verified,
    fairness: result.fairness,
    buyerSavedCents: result.buyerSavedCents,
    shopGainedCents: result.shopGainedCents,
    priceCents: n.agreedPriceCents,
    buyerCommit: buyer.commitment,
    shopCommit: shop.commitment,
    reasons: result.reasons,
  };

  const seq = await store.nextSeq(negotiationId);
  const event = store.makeEvent(negotiationId, seq, {
    t: "proof.revealed",
    verified: result.verified,
    fairness: result.fairness,
    buyerSavedCents: result.buyerSavedCents,
    reasons: result.reasons,
  });
  await store.appendEvent(event);
  if (onEvent) await onEvent(event);

  return proof;
}
