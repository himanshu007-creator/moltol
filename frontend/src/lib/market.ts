import type { Market } from './events';
import { getProduct } from './catalog';

/**
 * Channel3 stand-in (plan.md §4). Real call later: `market.comps(query)`.
 * Deterministic so the demo, tests and screenshots are reproducible.
 */

export interface CompSample {
  title: string;
  retailer: string;
  priceCents: number;
}

export interface Comps {
  query: string;
  market: Market;
  samples: CompSample[];
  source: 'channel3';
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

const RETAILERS = ['Bazaar Direct', 'MegaMart', 'IndiaMela', 'ShopNest', 'UrbanHaul'];

/** Comps clustered around a product's list price, stable per query. */
export async function getComps(query: string): Promise<Comps> {
  const base = getProduct(query)?.listPriceCents ?? 3000;
  const seed = hash(query);
  const median = Math.round(base * (0.74 + seed * 0.1));
  const p25 = Math.round(median * 0.82);
  const p75 = Math.round(median * 1.22);

  const samples: CompSample[] = Array.from({ length: 5 }, (_, i) => {
    const s = hash(`${query}:${i}`);
    const price = Math.round(p25 + (p75 - p25) * s);
    return {
      title: query.replace(/-/g, ' '),
      retailer: RETAILERS[Math.floor(s * RETAILERS.length)] ?? 'MegaMart',
      priceCents: price,
    };
  }).sort((a, b) => a.priceCents - b.priceCents);

  return { query, market: { medianCents: median, p25Cents: p25, p75Cents: p75 }, samples, source: 'channel3' };
}
