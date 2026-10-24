/**
 * Name search for the vendor's "Snap" add-item flow: a dev-only product
 * search proxy (`scripts/local-api.mjs`, `PUBLIC_API_BASE`) with no
 * offline/catalogue fallback — there's no real backend endpoint for this yet
 * (see BE_MISSING_THINGS.md). The real, backend-wired piece of this flow is
 * `backendComps()` (`lib/backend.ts`, `GET /v1/market/comps`), used
 * alongside this for the price-range display.
 */
import type { StockDraft } from '@/lib/inventory';

export type Suggestion = Pick<StockDraft, 'name' | 'category' | 'emoji' | 'unit' | 'listCents' | 'compKey'>;
export type DetectSource = 'vision' | 'serpapi-lens' | 'catalogue';

export interface Detection {
  suggestions: Suggestion[];
  source: DetectSource;
  /** shown under the photo, in plain words */
  note: string;
}

// Dev-only proxy. Undefined in production — searchItems() then always returns no results.
const BASE: string | undefined = import.meta.env.PUBLIC_API_BASE ?? (import.meta.env.DEV ? '' : undefined);

/** One backend call. Null when there is no backend, it fails, or it takes longer than 8 s. */
async function post<T>(path: string, body: unknown): Promise<T | null> {
  if (BASE === undefined) return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Resize to a square thumbnail and return a JPEG data URL. */
export async function toThumb(file: File, size = 160): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(size / bitmap.width, size / bitmap.height, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.75);
}

/** Name search via the dev-only proxy; empty (not a fake catalogue) when there's no server. */
export async function searchItems(query: string): Promise<{ results: Suggestion[]; source: 'serpapi-shopping' | 'catalogue' }> {
  const q = query.trim();
  if (!q) return { results: [], source: 'catalogue' };
  const remote = await post<{ results: Suggestion[] }>('/v1/search/products', { q });
  if (remote?.results?.length) return { results: remote.results, source: 'serpapi-shopping' };
  return { results: [], source: 'catalogue' };
}
