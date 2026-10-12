# MolTol (मोल-तोल)

**Where agents haggle and PayPal settles.** A voice-first bazaar where AI agents
haggle on your behalf, every deal stays provably fair, and payment closes over
PayPal — all from a browser.

This is the **frontend**. It ships fully runnable in **mock mode**: no backend,
no live API keys, no SerpAPI/PayPal calls from the browser. The mock seam is a
single adapter layer, so wiring the real services later is a swap, not a rewrite.

## Quickstart (mock mode, no backend)

```bash
pnpm install
pnpm dev                    # http://localhost:4321
```

No `.env` needed to boot. **On first load the app auto-provisions a demo
account** holding *both* roles (buyer and seller) straight into IndexedDB —
there is no login screen to click through. Open the site and you're already
signed in as the demo user "Reema", buyer role, Simple-mode seller profile
ready. Use the avatar menu in the header (**Account menu**) to switch between
**Switch to buyer** / **Switch to seller** instantly, no reload, state
preserved on both sides.

To test the real phone + OTP flow instead (`/login`, `/signup`), log out from
the account menu first — a logout is the only thing that's "sticky" (the demo
account won't re-auto-provision after an explicit logout). The mock OTP is
always **`1234`**.

To start over completely (wipe the demo account and every store): open
devtools → Application → Storage → **Clear site data** (or just use a private
window), then reload.

### Two demo paths

- **Buyer:** `/app/buy` → pick a stall → add items → `View basket` → `Start
  haggling` → watch parallel lanes negotiate → optionally `Take over` a lane
  → `Proof & pay`.
- **Seller (Simple Mode):** `/app/seller/simple` → big-target voice-first
  stall, seeded with a few starter products → `Deals` → accept the incoming
  offer → see it land in `Earnings`.

## Run the full demo end to end

Everything runs from seeds and IndexedDB — no backend. Open two tabs to see
state sync live between buyer and seller.

1. **Tab 1 (seller):** switch to seller from the account menu, then **Switch
   to Modern dashboard** (Settings, or straight to `/app/seller/inventory`).
   Add an item by hand, from CSV (`Download sample`), by voice
   (`20 kilo tamatar, 30 rupaye kilo`), or with **Snap** → **Search by name**
   (see SerpAPI below). Try a lowest price below cost to see the inline
   error. Adjust stock, archive, undo.
2. **Seller:** `/app/seller/shop`, or the stall-open switch. Close the stall
   now, or use **Close in 15 min**.
3. **Tab 2 (buyer):** `/app/buy` shows the stall greyed under *Closed now*.
   `/app/stall?id=demo-01` shows the closed banner and disabled Add. Reopen
   it in the seller tab and both windows update (shared `moltol-venue` store).
4. **Buyer:** basket → pick a haggle style (Quick Deal, Balanced, Hard
   Bargain), then start the parallel haggle. Take over a lane, or accept all,
   then Proof & pay.
5. **Seller:** `/app/seller/ledger` shows revenue, profit, margin, dead and
   low stock, and health hints. Apply a hint with one tap.
6. **Buyer:** `/app/insights` shows savings, budget bar, a 6-month chart, a
   price nudge, and the saved haggle style.

### SerpAPI (real product search for vendor uploads)

The vendor **Snap → Search by name** fallback (and the photo path's fallback
note) can use real Google Shopping results instead of the offline catalogue.
Add your key to `.env.local` (git-ignored, dev-only, never reaches the
browser — see `scripts/local-api.mjs`):

```bash
echo "SERPAPI_API_KEY=your-key-here" >> .env.local
pnpm dev
```

Without a key the search still works — it falls back to the offline
catalogue and shows which source produced the results. Photo recognition
(Snap → the camera path) always falls back to the catalogue on a local dev
server: Google Lens needs a public image URL, which `localhost` can't provide
without a real backend.

## Wiring the backend

Only the seams listed in `docs/BE_HANDOFF.md` change. In short:

1. Set `PUBLIC_USE_FIXTURE=false`, `PUBLIC_API_BASE`, `PUBLIC_WS_BASE` in `.env`.
2. Keep the zustand store shapes; swap their reads/writes for the endpoints in
   `docs/BE_HANDOFF.md` §4 (the stores become caches).
3. Replace the `BroadcastChannel` in `src/stores/venue.ts` with the `shop.status` WebSocket
   topic (§5).
4. Implement the `PaymentGateway` (create order, approve, capture, status) with the PayPal JS SDK
   v6 (sandbox only). `docs/BE_HANDOFF.md` §6 lists the hooks.
5. Strip seller `minCents` from every buyer response (§8).

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Astro dev server (default port 4321) |
| `pnpm build` | Static production build to `dist/` (25 pages) |
| `pnpm preview` | Serve the built output |
| `pnpm check` | `astro check` + `tsc --noEmit` (types the `.astro`, `.ts` and `tests/`) |
| `pnpm test:e2e` | Playwright end-to-end suite (desktop + mobile, includes axe a11y) |
| `pnpm test:e2e:ui` | Playwright UI mode |

### Tests

Playwright runs two projects — `desktop-chromium` and `mobile-chromium`
(Pixel 7, 360×640) — and its dev server uses **port 4331** (see
`playwright.config.ts`) so it never collides with a `pnpm dev` you already have
running on 4321.

```
buyer-flow.spec.ts    haggle → take one lane over → pay → land on orders
seller-flow.spec.ts   accept the incoming offer → see it in earnings
toggle-role.spec.ts   buyer shell flips to the seller home mid-flow
vendor-flow.spec.ts   add item, CSV import, snap-to-add, search by name (SerpAPI or catalogue)
discovery.spec.ts     GPS/walk fallback, stall open/closed sync, map
scan-flow.spec.ts     Simple Mode scan → manual picker → publish
surfaces.spec.ts      landing has no app shell, signed-in redirect, language switch
a11y.spec.ts          axe: no critical/serious violations across every route, both themes
```

Every spec imports `test`/`expect` from `./fixtures`, not `@playwright/test`
directly — that fixture flags the page so the app's own first-visit demo
auto-login (see Quickstart) never runs during tests, which otherwise race a
spec's own seeded IndexedDB state for the same keys.

## Architecture

- **Astro** for routes/shell, **React 19** islands (`client:load`) for the
  interactive flows, **Tailwind v4** (tokens in `src/styles/global.css`),
  **zustand** for client state, **three.js / R3F** for the 3D bazaar.
- State lives in `src/stores/*`; the negotiation engine is
  `src/lib/negotiation.ts` (a pure reducer). Money is always **integer paise**
  (₹); nothing divides until the final render.
- Static output means dynamic ids travel in the query string (`?id=`), and
  programmatic navigation goes through Astro's `navigate()` (soft nav, same
  JS realm) — never `location.href`: a hard reload can outrun the async
  IndexedDB write of whatever state the action just set.

```
src/
  lib/mock/       ← the mock seam (auth, market, seeds) — swap these for the API
  lib/negotiation.ts, ws.ts, policy.ts, voice.ts, …
  lib/routes.ts   ← the only place a path string belongs; ROUTES, homeFor(), migratePath
  lib/idb.ts, lib/hydrated.ts ← IndexedDB storage adapter, hydration-wait helper
  stores/         ← zustand, all IndexedDB-backed: session cart bazaar orders simple venue inventory ledger buyer
  components/     ← buyer/, vendor/, simple/, discovery/, Shell, astro/ (Base, Header)
  pages/          ← Astro routes, under app/ for the product surface
```

## Mock seams (what to swap)

Everything is behind **`src/lib/mock/`** plus the transport shim
`src/lib/ws.ts`. Flip `PUBLIC_USE_FIXTURE=false` and back these adapters:

| Seam | File | Replace with |
| --- | --- | --- |
| Fixture event stream | `src/lib/ws.ts` (`useFixture()`), `src/lib/mock/seeds.ts` (`buildScript`, `buildCartScript`) | WebSocket transport to `PUBLIC_WS_BASE` (`/v1/stream/:negotiationId`); the `FixtureTransport` becomes `WebSocketTransport` |
| Auth + OTP | `src/lib/mock/auth.ts` | Real auth endpoints; drop the always-`1234` OTP |
| Marketplace / comps | `src/lib/mock/market.ts` | SerpAPI-backed listings + comps (`medianCents`/`p25Cents`/`p75Cents`) |
| Seeded shops & demo history | `src/lib/mock/seeds.ts` | `PUBLIC_API_BASE` |
| Payment | `src/components/buyer/PayFlow.tsx` | PayPal JS SDK v6 (`PUBLIC_PAYPAL_CLIENT_ID`, sandbox); server-side capture |

Every persisted store (session, cart, bazaar negotiation, orders, simple,
venue, inventory, ledger, buyer) lives in **IndexedDB** (`moltol` / `kv`,
`src/lib/idb.ts`) through zustand `persist`, with an in-memory fallback when
IndexedDB is blocked (private windows, some embedded browsers — it still
runs, it just forgets on reload). Data survives reloads and stays compatible
with the real backend shape (see `docs/BE_HANDOFF.md`).

## License

MIT — see `package.json`. Not affiliated with or endorsed by PayPal; uses the
PayPal sandbox for demonstration only.
