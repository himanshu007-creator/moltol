/**
 * Dev-only local API, mounted by astro.config.mjs in `astro dev`. It keeps the
 * SerpAPI key on the server: the browser calls /v1/* on the same origin and never
 * sees the key. Without a key the routes answer 503 and the app falls back to its
 * offline catalogue. Production builds have no server, so none of this ships.
 *
 *   SERPAPI_API_KEY=...   in .env.local
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function readKey(root) {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return process.env.SERPAPI_API_KEY ?? '';
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('SERPAPI_API_KEY='));
  return (line?.split('=')[1] ?? process.env.SERPAPI_API_KEY ?? '').trim();
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

/** Google Shopping through SerpAPI: real product titles and prices for a name search. */
async function searchProducts(key, q) {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google_shopping');
  url.searchParams.set('q', q);
  url.searchParams.set('gl', 'in');
  url.searchParams.set('hl', 'en');
  url.searchParams.set('currency', 'INR');
  url.searchParams.set('api_key', key);
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`serpapi ${res.status}`);
  const data = await res.json();
  return (data.shopping_results ?? []).slice(0, 8).map((r) => ({
    name: String(r.title ?? q).slice(0, 60),
    category: 'shopping',
    emoji: '🛒',
    unit: 'piece',
    listCents: Math.round(Number(r.extracted_price ?? 0) * 100) || 4000,
  }));
}

export function localApi(root) {
  return {
    name: 'moltol-local-api',
    hooks: {
      'astro:server:setup': ({ server }) => {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== 'POST' || !req.url?.startsWith('/v1/')) return next();
          const key = readKey(root);
          try {
            const body = await readJson(req);
            if (req.url === '/v1/search/products') {
              if (!key) return send(res, 503, { error: 'SERPAPI_API_KEY not set' });
              return send(res, 200, { results: await searchProducts(key, String(body.q ?? '')) });
            }
            // vision and Lens need a public image URL, which a local server cannot provide
            return send(res, 503, { error: 'vision not configured' });
          } catch (e) {
            return send(res, 503, { error: String(e.message ?? e) });
          }
        });
      },
    },
  };
}
