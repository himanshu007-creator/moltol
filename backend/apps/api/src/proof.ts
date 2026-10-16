import type { NegotiationEvent, ProofResult } from "@moltol/contracts";
import { fromHex, verifyFairDeal } from "@moltol/policy";
import type { MoltolStore } from "@moltol/store";

/** States in which the deal is settled, so both limits may be revealed. */
const SETTLED = new Set(["paid", "revealed"]);

/**
 * Proof of Fair Deal, after settlement only (ADR 0002): reveal both sealed
 * limits and their salts, verify them against the commitments published before
 * the first turn, persist the result, and emit exactly one `proof.revealed`
 * (carrying the reveal, so any client can recompute the commitments itself).
 *
 * Returns null while the deal is not yet paid — revealing the floor to a buyer
 * who can still walk away and re-haggle would hand them the vendor's limit.
 * Safe to call repeatedly and concurrently.
 */
export async function revealProof(
  store: MoltolStore,
  negotiationId: string,
  publish?: (event: NegotiationEvent) => Promise<void>,
): Promise<ProofResult | null> {
  const n = await store.getNegotiation(negotiationId);
  if (!n || n.agreedPriceCents === null || !SETTLED.has(n.state)) return null;
  const [buyer, shop] = await Promise.all([
    store.getSealed(negotiationId, "buyer"),
    store.getSealed(negotiationId, "shop"),
  ]);
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
  const reveal = {
    buyerLimitCents: buyer.limitCents,
    buyerSalt: buyer.saltHex,
    shopFloorCents: shop.limitCents,
    shopSalt: shop.saltHex,
  };

  await store.upsertProof({
    negotiationId,
    priceCents: n.agreedPriceCents,
    verified: result.verified,
    fairness: result.fairness,
    buyerSavedCents: result.buyerSavedCents,
    shopGainedCents: result.shopGainedCents,
    detail: { buyerCommit: buyer.commitment, shopCommit: shop.commitment, reasons: result.reasons },
  });

  const event = await store.appendSystemEvent(
    negotiationId,
    {
      t: "proof.revealed",
      verified: result.verified,
      fairness: result.fairness,
      buyerSavedCents: result.buyerSavedCents,
      reasons: result.reasons,
      reveal,
    },
    { onceType: "proof.revealed", transition: { from: ["paid"], to: "revealed" } },
  );
  if (event && publish) await publish(event);

  return {
    negotiationId,
    verified: result.verified,
    fairness: result.fairness,
    buyerSavedCents: result.buyerSavedCents,
    shopGainedCents: result.shopGainedCents,
    priceCents: n.agreedPriceCents,
    currency: n.currency,
    buyerCommit: buyer.commitment,
    shopCommit: shop.commitment,
    reasons: result.reasons,
    reveal,
  };
}
