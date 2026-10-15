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
 *
 * With a `referenceCents` (a shop's list price) the spread is centred near that
 * price — median 90–104% of it — so a ₹40 tomato isn't benchmarked against a
 * generic $18–$40 band. Without one, the original $18–$40 band.
 */
export function seededComps(query: string, currency = "USD", referenceCents?: number): MarketRange {
  const h = hash(`${currency}:${query.toLowerCase().trim()}`);
  const median =
    referenceCents && referenceCents > 0
      ? referenceCents * (0.9 + (h % 15) / 100)
      : 1800 + (h % 2200); // $18.00 .. $40.00
  return {
    medianCents: round(median),
    p25Cents: round(median * 0.8),
    p75Cents: round(median * 1.25),
    sampleCount: 8 + (h % 40),
    source: "seed",
  };
}
