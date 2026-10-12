import type { Page } from '@playwright/test';
import type { Role } from '../src/stores/session';
import { SHOPS } from '../src/lib/mock/seeds';

/**
 * State seeds for the persisted zustand stores, injected before any page
 * script runs. Every store now persists to IndexedDB (src/lib/idb.ts: db
 * 'moltol', store 'kv') — see putIdb. Session also mirrors a tiny synchronous
 * auth hint to localStorage (see stores/session.ts); seed() writes that too,
 * so the pre-paint redirect scripts behave exactly as they do in the real app.
 *
 * IMPORTANT: call `seed(page, role)` — it passes the data as addInitScript
 * args. Do NOT reference these module-scope objects inside an inline
 * addInitScript callback: Playwright serializes the callback by source and
 * the closure is not captured in the browser context.
 */

const SESSION = (role: Role) => ({
  loggedIn: true,
  name: 'Reema',
  phone: '+91 98765 43210',
  avatarEmoji: '🙍🏽‍♀️',
  activeRole: role,
  buyerProfileDone: true,
  sellerProfileDone: true,
  lastRoute: { buyer: '/app/buy', seller: '/app/seller/simple' },
  sellerMode: 'simple',
  pendingNote: null,
});

export const SIMPLE = {
  onboarded: true,
  language: 'en',
  phone: '+91 98765 43210',
  phoneVerified: true,
  stallName: 'Demo ki Dukaan',
  stallEmoji: '🏪',
  products: [{ id: 'tomato', sellCents: 4000, floorCents: 3000 }],
  persona: 'charmer',
  mute: true,
  todayEarningsCents: 0,
  dealsLog: [],
  haggle: {
    step: 'offer',
    offerCents: 3400,
    lastOutcome: null,
    dealCents: null,
    offerItem: 'टमाटर',
    offerEmoji: '🍅',
  },
};

/**
 * Write one or more zustand-persist entries into the app's IndexedDB store
 * before the page's own scripts run, so the app boots already-hydrated. Keys
 * already present are left alone (a test that reseeds mid-flow must not
 * clobber state an earlier step mutated).
 */
async function putIdb(page: Page, entries: Record<string, { state: unknown; version: number }>) {
  await page.addInitScript((entriesData) => {
    const req = indexedDB.open('moltol', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const store = req.result.transaction('kv', 'readwrite').objectStore('kv');
      for (const [key, value] of Object.entries(entriesData)) {
        const get = store.get(key);
        get.onsuccess = () => {
          if (get.result == null) store.put(JSON.stringify(value), key);
        };
      }
    };
  }, entries);
}

export async function seed(page: Page, role: Role) {
  const session = SESSION(role);
  await putIdb(page, {
    'moltol-session': { state: session, version: 2 },
    'moltol-simple': { state: SIMPLE, version: 0 },
  });
  // the synchronous pre-paint hint (Base.astro's data-auth, /app and /app/seller redirects)
  await page.addInitScript((hint) => {
    try {
      localStorage.setItem('moltol-auth-hint', JSON.stringify(hint));
    } catch {
      /* ignore */
    }
  }, { loggedIn: true, activeRole: session.activeRole, sellerMode: session.sellerMode });
}

/**
 * Seed the shared venue store (moltol-venue). By default every stall is open;
 * pass `closed` with stall ids (e.g. DEMO_SLOT_ID) to close them for discovery.
 */
export async function seedVenue(page: Page, closed: string[] = []) {
  const stalls: Record<string, { open: boolean }> = {};
  for (const s of SHOPS) stalls[s.id] = { open: !closed.includes(s.id) };
  await putIdb(page, { 'moltol-venue': { state: { stalls }, version: 0 } });
}
