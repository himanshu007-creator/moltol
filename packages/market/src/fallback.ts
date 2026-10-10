import type { MarketRange } from "@moltol/contracts";

function hash(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function round(cents: number): number {
  return Math.round(cents / 100) * 100;
}

/**
 * Deterministic, offline comps. Used when no Channel3 key is configured (and as
 * the crash-safe fallback), so the demo never depends on a third party. The same
 * query always yields the same spread.
 */
export function seededComps(query: string, currency = "USD"): MarketRange {
  const h = hash(`${currency}:${query.toLowerCase().trim()}`);
  const median = 1800 + (h % 2200); // $18.00 .. $40.00
  return {
    medianCents: round(median),
    p25Cents: round(median * 0.8),
    p75Cents: round(median * 1.25),
    sampleCount: 8 + (h % 40),
    source: "seed",
  };
}
