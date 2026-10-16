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
 * Derive a standalone negotiation's counterparty shop from a seed + the market.
 * The engine seeds it with the shop seal's secret salt, so the floor is fixed
 * once sealed but can't be computed by anyone else before the reveal (seeding it
 * with the public negotiation id, as before, made it computable).
 */
export function deriveShop(seed: string, market: MarketRange): ShopModel {
  const rand = seededRandom(`shop:${seed}`);
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
