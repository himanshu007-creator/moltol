/**
 * Name search for the vendor's "Snap" add-item flow, now wired to the real
 * `POST /v1/search/products` on the real backend (`lib/backend.ts`'s
 * `PUBLIC_BACKEND_BASE`) — no offline/catalogue fallback. Used alongside
 * `backendComps()` (`lib/backend.ts`, `GET /v1/market/comps`) for the
 * price-range display.
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

const BASE: string | undefined = import.meta.env.PUBLIC_BACKEND_BASE as string | undefined;

/** One backend call. Null when there is no backend, it fails, or it takes longer than 8 s. */
async function post<T>(path: string, body: unknown): Promise<T | null> {
  if (!BASE) return null;
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

/** Name search via the real backend; empty (not a fake catalogue) when it has nothing or there's no server. */
export async function searchItems(query: string): Promise<{ results: Suggestion[]; source: 'backend' | 'catalogue' }> {
  const q = query.trim();
  if (!q) return { results: [], source: 'catalogue' };
  const remote = await post<{ results: Suggestion[] }>('/v1/search/products', { q });
  if (remote?.results?.length) return { results: remote.results, source: 'backend' };
  return { results: [], source: 'catalogue' };
}
