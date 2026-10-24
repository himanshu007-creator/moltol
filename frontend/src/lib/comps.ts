import type { InventoryItem } from '@/lib/types';
import type { Market } from '@/lib/events';

/** Market band for an item — every real item carries its own (set from the backend's own price). */
export function compsOf(item: InventoryItem): Market {
  const m = item.market ?? { median: item.listCents, p25: Math.round(item.listCents * 0.9), p75: Math.round(item.listCents * 1.1) };
  return { medianCents: m.median, p25Cents: m.p25, p75Cents: m.p75, sampleCount: 0, source: 'seed' };
}
