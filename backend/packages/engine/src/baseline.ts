import type { MarketRange } from "@moltol/contracts";
import { roundToWholeDollars } from "@moltol/policy";

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ShopModel {
  /** Private floor — a sealed secret, never sent to the LLM or the buyer. */
  floorCents: number;
  /** Public list/open price — the first ask, and the domain for the range proof. */
  openCents: number;
  domainCents: number;
}

/**
 * Derive this negotiation's counterparty shop from its id + market, so the
 * secret floor is stable across restarts but varies per negotiation.
 */
export function deriveShop(negotiationId: string, market: MarketRange): ShopModel {
  const rand = seededRandom(`shop:${negotiationId}`);
  const floorFactor = 0.85 + rand() * 0.18;
  const floorCents = Math.max(
    100,
    roundToWholeDollars(Math.min(market.medianCents, market.p25Cents * floorFactor)),
  );
  const openCents = Math.max(
    floorCents + 200,
    roundToWholeDollars(market.p75Cents * (1.05 + rand() * 0.25)),
  );
  return { floorCents, openCents, domainCents: openCents };
}
