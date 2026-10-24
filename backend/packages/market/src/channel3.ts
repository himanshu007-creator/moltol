import { z } from "zod";
import type { MarketRange } from "@moltol/contracts";

const SearchResponseSchema = z.object({
  products: z
    .array(
      z.object({
        offers: z
          .array(
            z.object({
              price: z.object({
                price: z.number().nonnegative(),
                currency: z.string().optional(),
              }),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx]!;
}

/** Convert an offer price (major units) to cents in the requested currency. */
function toCents(
  amount: number,
  offerCurrency: string,
  requested: string,
  fxUsdPerInr: number,
): number | null {
  const currency = offerCurrency.toUpperCase();
  if (currency === requested) return Math.round(amount * 100);
  // Only USD<->INR is known; other currencies are skipped rather than guessed.
  if (requested === "INR" && currency === "USD" && fxUsdPerInr > 0) {
    return Math.round((amount / fxUsdPerInr) * 100);
  }
  if (requested === "USD" && currency === "INR" && fxUsdPerInr > 0) {
    return Math.round(amount * fxUsdPerInr * 100);
  }
  return null;
}

/**
 * Channel3 product-search client (POST /v1/search, `x-api-key`). Reduces live
 * offers across products to a market range, converting USD offers to INR with the
 * API's configured rate when needed. Any failure returns null so the caller can
 * fall back to the next provider (SerpAPI, then seeds) — never throws into the
 * negotiation loop.
 */
export async function channel3Comps(params: {
  query: string;
  currency: string;
  apiKey: string;
  baseUrl: string;
  fxUsdPerInr?: number;
  limit?: number;
  timeoutMs?: number;
}): Promise<MarketRange | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 4000);
  try {
    const url = new URL("/v1/search", params.baseUrl);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": params.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ query: params.query, limit: params.limit ?? 20 }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const parsed = SearchResponseSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    const requested = params.currency.toUpperCase();
    const fxUsdPerInr = params.fxUsdPerInr ?? 0;
    const prices = parsed.data.products
      .flatMap((p) => p.offers)
      .map((o) => toCents(o.price.price, o.price.currency ?? requested, requested, fxUsdPerInr))
      .filter((c): c is number => c !== null && c > 0)
      .sort((a, b) => a - b);
    if (prices.length === 0) return null;
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
