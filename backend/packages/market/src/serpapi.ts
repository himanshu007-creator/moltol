import { z } from "zod";
import type { MarketRange } from "@moltol/contracts";

/**
 * SerpAPI Google Shopping comps. Used when a SerpAPI key is configured; a cheap,
 * well-known way to get real offer prices without a market-data contract. Like the
 * Channel3 client, any failure returns null so the caller falls back to seeds.
 */

const SerpResponseSchema = z.object({
  shopping_results: z
    .array(
      z.object({
        extracted_price: z.number().nonnegative().optional(),
        price: z.string().optional(),
      }),
    )
    .default([]),
});

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx]!;
}

/** "$1.99" / "₹45" / "1.299,00 €" → 199 / 4500 / 129900 (best effort). */
function parsePrice(text: string): number | null {
  const digits = text.replace(/[^\d.,]/g, "");
  if (!digits) return null;
  // Whatever the grouping, the decimal is the LAST separator followed by 1–2 digits.
  const normalized = (() => {
    const m = /^(.*)[.,](\d{1,2})$/.exec(digits);
    if (m) return `${m[1]!.replace(/[.,]/g, "")}.${m[2]}`;
    return digits.replace(/[.,]/g, "");
  })();
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export async function serpapiComps(params: {
  query: string;
  currency: string;
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<MarketRange | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 4000);
  try {
    const url = new URL(params.baseUrl ?? "https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_shopping");
    url.searchParams.set("q", params.query);
    url.searchParams.set("api_key", params.apiKey);
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const parsed = SerpResponseSchema.safeParse(await res.json());
    if (!parsed.success) return null;

    const cents = parsed.data.shopping_results
      .map((o) => {
        if (o.extracted_price !== undefined) return o.extracted_price;
        return o.price !== undefined ? parsePrice(o.price) : null;
      })
      .filter((v): v is number => v !== null && v > 0)
      .map((v) => Math.round(v * 100))
      .sort((a, b) => a - b);
    if (cents.length === 0) return null;

    return {
      medianCents: percentile(cents, 0.5),
      p25Cents: percentile(cents, 0.25),
      p75Cents: percentile(cents, 0.75),
      sampleCount: cents.length,
      source: "serpapi",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
