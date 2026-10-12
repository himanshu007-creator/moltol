/**
 * Mock market layer — the only place "outside" prices come from.
 * Real impl = a backend proxy to SerpAPI (or a pricing feed). NEVER call it or
 * hold the key in the browser. Swapping adapters here is all wiring changes.
 */

import { COMP_LIB, seededRandom, SHOPS, type ItemLib, type InventoryItem } from './seeds';
import type { Market } from '@/lib/events';

export function comps(itemId: ItemLib): Market {
  const m = COMP_LIB[itemId];
  return { medianCents: m.median, p25Cents: m.p25, p75Cents: m.p75 };
}

/** Market band for a concrete item: its own band if it has one, else the library. */
export function compsOf(item: InventoryItem): Market {
  const m = item.market ?? COMP_LIB[item.itemId];
  return { medianCents: m.median, p25Cents: m.p25, p75Cents: m.p75 };
}

export interface CompsSample {
  shopId: string;
  name: string;
  emoji: string;
  priceCents: number;
  distanceM: number;
}

/** Deterministic nearby-prices list — shaped like a real aggregator response. */
export function samples(itemId: ItemLib): CompsSample[] {
  const rng = seededRandom('comps:' + itemId);
  const m = comps(itemId);
  return SHOPS.map((s) => {
    const priceCents = Math.round((m.medianCents * (0.94 + rng() * 0.14)) / 100) * 100;
    return { shopId: s.id, name: s.name.en, emoji: s.emoji, priceCents, distanceM: s.distanceM };
  }).sort((a, b) => a.priceCents - b.priceCents);
}

/** Cheapest cross-market price for an item's market — the "you could save" nudge. */
export function cheapest(itemId: ItemLib): CompsSample | undefined {
  return samples(itemId)[0];
}

export function marketDelta(item: InventoryItem): number {
  return item.listCents - compsOf(item).medianCents;
}

/* ----------------------- proximity / presence seam ----------------------- */

export type ProximitySource = 'walk' | 'gps' | 'qr' | 'ble';

export interface ProximityProvider {
  source: ProximitySource;
  /** meters from user dot to each shop; drives sorting + ripple radius */
  distances(): Record<string, number>;
}

/**
 * Mock walking simulation — dev slider sets a radius that shrinks distances.
 * Geolocation/QR/BLE implement the same interface (BLE beacons plug in here).
 */
export function walkingProvider(radiusM: number): ProximityProvider {
  return {
    source: 'walk',
    distances: () => {
      const out: Record<string, number> = {};
      for (const s of SHOPS) {
        const d = Math.max(15, Math.round(s.distanceM * (radiusM / 500)));
        out[s.id] = d;
      }
      return out;
    },
  };
}