/**
 * Snap-to-add detection, with a fallback chain:
 *   1. vision model on the backend (PUBLIC_API_BASE)
 *   2. SerpAPI Google Lens via the backend (the key never reaches the browser)
 *   3. the local catalogue, which always works offline
 * A name search does the same: backend product search (SerpAPI Shopping), then the
 * local catalogue. Every result says which step produced it.
 */
import { SNAP_SUGGESTIONS, type StockDraft } from '@/lib/inventory';
import { VEG_CATALOG } from '@/lib/vision/catalog';
import { COMP_LIB, type ItemLib } from '@/lib/mock/seeds';

export type Suggestion = Pick<StockDraft, 'name' | 'category' | 'emoji' | 'unit' | 'listCents' | 'compKey'>;
export type DetectSource = 'vision' | 'serpapi-lens' | 'catalogue';

export interface Detection {
  suggestions: Suggestion[];
  source: DetectSource;
  /** shown under the photo, in plain words */
  note: string;
}

// Production: PUBLIC_API_BASE if set, else no server. Dev: same-origin /v1 (scripts/local-api.mjs).
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

/** The offline catalogue: common shop items plus the vegetable set. */
export function catalogueSuggestions(): Suggestion[] {
  const veg: Suggestion[] = VEG_CATALOG.map((v) => {
    const lib = COMP_LIB[v.key as ItemLib];
    return {
      name: v.en,
      category: 'vegetable',
      emoji: v.emoji,
      unit: 'kg',
      listCents: lib?.median ?? 3000,
      compKey: lib ? v.key : undefined,
    };
  });
  const seen = new Set<string>();
  return [...SNAP_SUGGESTIONS, ...veg].filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));
}

/** Suggestions for a photo, through the fallback chain. */
export async function detectItems(thumb: string): Promise<Detection> {
  const vision = await post<{ suggestions: Suggestion[] }>('/v1/inventory/snap', { image: thumb, provider: 'vision' });
  if (vision?.suggestions?.length) {
    return { suggestions: vision.suggestions, source: 'vision', note: 'Recognised by the vision model.' };
  }
  const lens = await post<{ suggestions: Suggestion[] }>('/v1/inventory/snap', { image: thumb, provider: 'serpapi-lens' });
  if (lens?.suggestions?.length) {
    return { suggestions: lens.suggestions, source: 'serpapi-lens', note: 'Matched with Google Lens (SerpAPI).' };
  }
  await new Promise((r) => setTimeout(r, 700));
  return {
    suggestions: catalogueSuggestions(),
    source: 'catalogue',
    note: BASE
      ? 'The server could not match this photo, so these are common items. Search by name below.'
      : 'No server is connected. These are common items from the offline catalogue. Search by name below.',
  };
}

/** Name search: backend product search (SerpAPI Shopping) first, then the offline catalogue. */
export async function searchItems(query: string): Promise<{ results: Suggestion[]; source: 'serpapi-shopping' | 'catalogue' }> {
  const q = query.trim();
  if (!q) return { results: [], source: 'catalogue' };
  const remote = await post<{ results: Suggestion[] }>('/v1/search/products', { q });
  if (remote?.results?.length) return { results: remote.results, source: 'serpapi-shopping' };
  const term = q.toLowerCase();
  return { results: catalogueSuggestions().filter((s) => s.name.toLowerCase().includes(term)), source: 'catalogue' };
}
