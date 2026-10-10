import { z } from "zod";
import type { MarketRange } from "@moltol/contracts";

const CompsResponseSchema = z.object({
  offers: z
    .array(
      z.object({
        priceCents: z.number().int().nonnegative(),
      }),
    )
    .default([]),
});

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx]!;
}

/**
 * Channel3 offers-spread client. Queries live offers for a product query, then
 * reduces them to a market range. Any failure returns null so the caller can fall
 * back to the seeded dataset (never throws into the negotiation loop).
 */
export async function channel3Comps(params: {
  query: string;
  currency: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
}): Promise<MarketRange | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 4000);
  try {
    const url = new URL("/v1/search", params.baseUrl);
    url.searchParams.set("q", params.query);
    url.searchParams.set("currency", params.currency);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${params.apiKey}`, accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const parsed = CompsResponseSchema.safeParse(await res.json());
    if (!parsed.success || parsed.data.offers.length === 0) return null;
    const prices = parsed.data.offers.map((o) => o.priceCents).sort((a, b) => a - b);
    return {
      medianCents: percentile(prices, 0.5),
      p25Cents: percentile(prices, 0.25),
      p75Cents: percentile(prices, 0.75),
      sampleCount: prices.length,
      source: "channel3",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
