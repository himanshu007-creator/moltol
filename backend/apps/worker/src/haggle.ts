import type { Negotiation, Turn } from "@moltol/contracts";
import { concession, openingAnchor, PERSONA_BETA, shouldAccept, validateOffer } from "@moltol/policy";

export interface HaggleResult {
  turns: Turn[];
  state: "agreed" | "no_deal";
  agreedPriceCents: number | null;
}

/**
 * Scaffold negotiation runner. Deterministic: the policy package owns every
 * price; the LLM (added later) will only supply wording. A real market/comps
 * lookup replaces the synthetic numbers below.
 */
export function runStubHaggle(n: Negotiation): HaggleResult {
  const max = n.maxTotalCents;
  // Synthetic counterparty: floor at 70% of the buyer's mandate, list at 110%.
  const shopFloor = Math.round(max * 0.7);
  const shopOpen = Math.round(max * 1.1);
  const p25 = Math.round(max * 0.75);

  const beta = PERSONA_BETA[n.persona] ?? 0.6;
  const buyerOpen = openingAnchor({ p25Cents: p25, maxTotalCents: max });

  const turns: Turn[] = [];
  let seq = 0;
  let agreedPrice: number | null = null;

  for (let t = 0; t < n.roundsMax; t++) {
    const buyerOffer = concession({ openCents: buyerOpen, limitCents: max, t, T: n.roundsMax, beta });
    const shopCounter = concession({
      openCents: shopOpen,
      limitCents: shopFloor,
      t,
      T: n.roundsMax,
      beta: 0.8,
    });

    // Buyer makes an offer, guarded.
    const buyerCheck = validateOffer({ side: "buyer", priceCents: buyerOffer, limitCents: max, maxTotalCents: max });
    turns.push({
      seq: seq++,
      actor: "buyer",
      kind: t === 0 ? "offer" : "counter",
      priceCents: buyerOffer,
      message: buyerCheck.ok ? `I can do ${(buyerOffer / 100).toFixed(2)}.` : "Let me adjust.",
      tactic: t === 0 ? "anchor" : "market-cite",
    });

    // Shop accepts if the buyer's offer clears its next counter and floor.
    if (shouldAccept({ side: "shop", incomingCents: buyerOffer, myNextOfferCents: shopCounter, myLimitCents: shopFloor })) {
      turns.push({ seq: seq++, actor: "shop", kind: "accept", priceCents: buyerOffer, message: "Deal.", tactic: "plain" });
      agreedPrice = buyerOffer;
      break;
    }

    const shopCheck = validateOffer({ side: "shop", priceCents: shopCounter, limitCents: shopFloor, maxTotalCents: max });
    turns.push({
      seq: seq++,
      actor: "shop",
      kind: "counter",
      priceCents: shopCounter,
      message: shopCheck.ok ? `Best I can do is ${(shopCounter / 100).toFixed(2)}.` : "That is not possible.",
      tactic: "final-offer",
    });

    if (shouldAccept({ side: "buyer", incomingCents: shopCounter, myNextOfferCents: buyerOffer, myLimitCents: max })) {
      turns.push({ seq: seq++, actor: "buyer", kind: "accept", priceCents: shopCounter, message: "Agreed.", tactic: "plain" });
      agreedPrice = shopCounter;
      break;
    }
  }

  return agreedPrice === null
    ? { turns, state: "no_deal", agreedPriceCents: null }
    : { turns, state: "agreed", agreedPriceCents: agreedPrice };
}
