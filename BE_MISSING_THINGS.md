# What the backend is missing, relative to the frontend

This document compares the backend actually pushed to `origin/main` (now living
in `backend/`) against what the frontend (`frontend/`, built independently and
fully over the course of this project) implements and expects. It exists
because the two were built in isolation — the frontend against a documented
mock contract (`frontend/docs/BE_HANDOFF.md`), the backend against its own
design (`backend/docs/adr/*.md`, `backend/AGENTS.md`) — and nobody has yet sat
the two specs side by side. The goal is an honest, concrete list either side
can act on before they're wired together.

## Summary

The two halves are not close: they implement two different products that
happen to share a name and a money-is-integer-cents convention. The backend
is a single-negotiation engine — one buyer, one abstract "shop" derived
on-the-fly from a market-comps lookup (`backend/packages/engine/src/
baseline.ts`'s `deriveShop()`), one `query` string, one deal, with genuinely
strong cryptographic machinery behind it (commit-reveal sealed limits in
`backend/packages/policy/src/crypto.ts` and `range-proof.ts`, a real PayPal
Orders v2 client with idempotent capture and verified webhooks in
`backend/packages/paypal/`). The frontend is a multi-vendor bazaar: named
shops with real inventories a vendor manages (add/edit/archive/CSV
import/voice entry), a buyer who haggles an entire basket as N parallel
negotiation lanes against one shop simultaneously, login/signup/OTP and a
dual-role account, GPS-based discovery, voice narration, and — as of this
session — demo auto-provisioning and a negotiation model that is guaranteed
to always reach a price, never an organic no-sale. None of that marketplace,
auth, or inventory layer exists in the backend's schema (`backend/packages/
store/src/schema.ts` has exactly five tables: negotiations, negotiation
events, sealed secrets, payments, webhook events — no users, no shops, no
products, no sessions). The single biggest structural mismatch is the
negotiation primitive itself: backend is "one query → one deal," frontend is
"one basket → many simultaneous per-SKU deals against a chosen shop," and
`frontend/docs/BE_HANDOFF.md` already names this gap explicitly (`lineItemId`
is nowhere in the backend's contracts). The second-biggest risk for a
hackathon submission is that the pieces each side is proudest of — the
backend's cryptographic fairness proof and the frontend's gamified,
multi-vendor haggling UI — cannot be demoed together as they stand: the
frontend's UI has nothing real to call, and the backend has nothing that
looks like the bazaar in the frontend's screenshots. A believable demo needs
either a thin adapter layer that maps the frontend's basket/lane model onto
repeated single-negotiation backend calls (fastest path, some loss of
"parallel lanes against one real vendor" fidelity), or backend schema changes
to add shops/inventory/multi-line negotiations (truer to the product, more
work). Three smaller but real mismatches compound this: the market-comps
provider differs (backend calls Channel3, frontend tested and is wired for
SerpAPI — `frontend/docs/BE_HANDOFF.md` open question #4 asked this and was
never answered), the transport differs (backend streams SSE, the frontend's
handoff doc and `src/lib/ws.ts` assume WebSocket), and the two sides disagree
on what a "no deal" should mean (backend's `runHaggle` can organically end a
negotiation with `session.ended / no_zopa`; the frontend deliberately removed
that outcome this session on the view that haggling with an item already in
the basket should always land on a price). None of this is unfixable — the
backend's event vocabulary, money handling, and state machine are well-formed
and could absorb most of these changes — but as of right now, pointing the
frontend's `PUBLIC_API_BASE` at the backend and flipping `PUBLIC_USE_FIXTURE`
to `false` would not produce a working demo.

## Checklist

### Auth, session, and the dual-role account

- [ ] No auth endpoints exist at all. `frontend/docs/BE_HANDOFF.md` §4 specifies `POST /v1/auth/otp`, `POST /v1/auth/verify`, `GET /v1/me`, `PATCH /v1/me/role` — none exist in `backend/apps/api/src/routes.ts`.
- [ ] No session/user concept in the backend schema (`backend/packages/store/src/schema.ts`) — no `users` table, no session token, nothing to authenticate a request against. Every backend route is unauthenticated today.
- [ ] Frontend's "dual-role, one account, switch without re-login" model (`frontend/src/stores/session.ts`: `activeRole: 'buyer'|'seller'`, `switchRole()`) has no backend equivalent — `PATCH /v1/me/role` per the handoff doc, not built.
- [ ] Frontend auto-provisions a demo account into IndexedDB on first load this session (`frontend/src/stores/session.ts` `provisionDemo()`, gated by a new `everLoggedOut` flag so it never re-fires after an explicit logout) specifically because there is no real backend account to log into. This is a local-only workaround, not something the backend needs to replicate, but it means the real login/signup/OTP endpoints have never been exercised against anything except the fixed mock OTP `1234` (`frontend/src/lib/mock/auth.ts`).
- [ ] Logout in the frontend now does a full local reset of every store (`frontend/src/components/Shell.tsx` logout handler) — there's no backend session to invalidate, so this is purely client-side and will need a real `/v1/auth/logout` (or token revocation) once a backend session exists.

### Shops, vendors, and inventory

- [ ] No `shops`/`stalls` table or entity anywhere in the backend. The frontend's `Shop` type (`frontend/src/lib/mock/seeds.ts`) — id, name, kind, emoji, lat/lng, persona, products, bundle — has no backend counterpart. `GET /v1/shops/nearby` and `GET /v1/shops/:id` (handoff §4) are not implemented.
- [ ] No inventory/product/SKU table. The frontend's seller-side `StockItemSchema` (`frontend/src/lib/inventory.ts`) — cost/min/list prices, stock qty, unit, low-stock threshold, archived flag — and the full CRUD the vendor console supports (add, edit, bulk list-% change, archive/restore, CSV import with per-row validation, adjust ± with a reason, undo) have no backend equivalent at all. None of `GET/POST /v1/inventory`, `PATCH /v1/inventory/:id`, `POST /v1/inventory/:id/adjust`, `POST /v1/inventory/bulk`, `POST /v1/inventory/import` (handoff §4) exist.
- [ ] No concept of a vendor opening/closing their stall. Frontend's `StallStatus` (`frontend/src/stores/venue.ts`: `{open, closeAt, reopenAt}`, synced live across tabs via `BroadcastChannel`) has no backend equivalent; `PUT /v1/shops/:id/status` (handoff §4) not implemented.
- [ ] The backend's negotiation does not reference a real shop or a real item at all — `deriveShop()` (`backend/packages/engine/src/baseline.ts`) synthesizes a floor/open price from the market-comps range for whatever `query` string was typed, seeded by `negotiationId` so it's stable but entirely fictional. There is no floor price a vendor actually set (`InventoryItem.minCents` in the frontend never reaches the backend because there's nowhere for it to go).

### The negotiation primitive: one deal vs. a basket of parallel lanes

- [ ] Backend's `CreateNegotiationSchema` (`backend/packages/contracts/src/negotiation.ts`) takes one `query` string and produces one negotiation with one outcome. The frontend's basket haggle (`frontend/src/stores/bazaar.ts` `start()`) runs one negotiation **lane per cart line** in parallel against one chosen shop, each with its own turns/price/outcome.
- [ ] `frontend/docs/BE_HANDOFF.md` §3 names this exact gap: *"the union is one negotiation per stream. The FE runs one lane per item (Lane.sku, Lane.itemId). Add lineItemId to every event (turn, deal.agreed, session.ended) and one session per line item under a cart-level negotiationId."* This has not been done — `lineItemId` does not appear anywhere in `backend/packages/contracts/`.
- [ ] `POST /v1/negotiations` per the handoff doc should accept `{shopId, lines: [{sku, qty}], scope, request, budgetCents?}` and return `{negotiationId, lines: [{lineItemId, sku}]}`. The backend's actual endpoint accepts `{query, persona, maxTotalCents, currency, roundsMax}` — a different shape entirely, with no `shopId` or `lines`.
- [ ] Per-lane manual control — "take over a lane" and make a human offer mid-negotiation — is a real frontend feature (`frontend/src/stores/bazaar.ts` `takeOver()`, `humanOffer()`, tested in `tests/buyer-flow.spec.ts`). The backend's state machine and event vocabulary (`backend/packages/contracts/src/negotiation.ts` `STATE_TRANSITIONS`) have no state or event for a human taking control mid-run, and the handoff doc's proposed endpoints for it (`POST /v1/negotiations/:id/lines/:lineItemId/takeover`, `.../offer`) don't exist.
- [ ] "Accept all" (settle every still-live lane at once) is a frontend action (`bazaar.ts` `acceptAll()`) with a proposed `POST /v1/negotiations/:id/accept-all` endpoint (handoff §4) that doesn't exist backend-side.

### Negotiation outcome semantics (no-deal vs. always-converge)

- [ ] This session, the frontend's negotiation simulator was deliberately rewritten so a haggle **always** ends in an agreed price — the buyer and shop's offers now monotonically converge every round (`frontend/src/lib/mock/seeds.ts` `buildScript()`), and the old "buyer can't make the floor, so no deal" organic failure mode was removed, on the reasoning that haggling over an item already in your basket should resolve to a price, not a walk-away. The product copy and UI (`BazaarTheatre.tsx`'s old "NO DEAL" chip and the no-deal-count banner) were built around the possibility of a no-deal lane, so they're now effectively dead paths on the frontend, kept only for the human-abandons-a-takeover edge case.
- [ ] The backend disagrees: `runHaggle()` (`backend/packages/engine/src/run-haggle.ts`) can and does organically end with `session.ended { reason: "no_zopa" }` whenever the buyer's concession curve doesn't reach the shop's floor within `roundsMax` — this is a real, reachable code path, not a hypothetical. Someone needs to decide: does the backend adopt the frontend's "always converge" stance (tune `deriveShop()`'s floor generation and/or the concession curves in `backend/packages/policy/src/concessions.ts` so ZOPA failure can't happen), or does the frontend's "always a deal" decision get walked back once it's talking to a backend that can genuinely say no? Shipping the two halves together without resolving this means the demo's behavior depends on which engine is running.

### Market comps provider

- [ ] Backend calls **Channel3** for market comps (`backend/packages/market/src/channel3.ts`, wired via `CHANNEL3_API_KEY` in `backend/apps/worker/src/index.ts`), with a seeded fallback when no key is configured.
- [ ] Frontend is built and tested against **SerpAPI** (Google Shopping) for the equivalent lookup — verified working end-to-end with a real key this session (`frontend/scripts/local-api.mjs`'s dev-only proxy, `frontend/src/lib/vision.ts` `searchItems()`, used by the vendor "search by name" flow and documented in `frontend/docs/BE_HANDOFF.md`'s mock-layer table: *"Market comps ... Real later: Channel3 / SerpAPI comps"*).
- [ ] `frontend/docs/BE_HANDOFF.md`'s open question #4 — *"Comps: Channel3 or SerpAPI Shopping for median/p25/p75?"* — was asked and never answered. Someone has to pick one (or support both behind `createMarketProvider`'s existing provider-swap pattern in `backend/packages/market/src/index.ts`, which already has the right shape for a second provider).
- [ ] Currency defaults disagree too: the backend's money contracts (`MoneySchema`, `CurrencySchema` in `backend/packages/contracts/src/money.ts`) default to `"USD"` and `formatMoney()` hardcodes a `$` symbol; the frontend is entirely ₹/INR (`frontend/src/lib/money.ts` uses `Intl.NumberFormat('en-IN', ...)`). Channel3's and SerpAPI's result currencies, and which one actually returns usable INR comps for an Indian bazaar, is itself an open question nobody has checked.

### Image / vision product recognition ("snap to add")

- [ ] Frontend's vendor "Snap to add" flow (`frontend/src/components/vendor/AddItem.tsx`, `frontend/src/lib/vision.ts` `detectItems()`) and Simple Mode's camera scanner (`frontend/src/components/simple/VegetableScanner.tsx`, now defaulting to a manual picker — see below) both document the same unresolved limitation: **a real photo-to-product Lens lookup needs the photo hosted at a public URL first**, and neither side has that. The frontend's dev proxy (`frontend/scripts/local-api.mjs`) always 503s the `/v1/inventory/snap` photo path for exactly this reason and falls back to an offline catalogue.
- [ ] This is not solely a frontend gap — the backend has no `/v1/inventory/snap` endpoint, no vision model integration, and no image upload/hosting story either (`frontend/docs/BE_HANDOFF.md`'s mock-layer table literally says *"Vision (snap): canned suggestions ... Real later: Vision model, SerpAPI Lens is an option"* — still open). Whoever builds this needs to solve image hosting (even a short-lived signed upload URL) before SerpAPI Lens or any vision model becomes usable.
- [ ] This session, Simple Mode's camera-based on-device-AI scan path (Chrome's experimental `window.LanguageModel`) was demoted from the default flow to an opt-in extra (`frontend/src/components/simple/VegetableScanner.tsx`, phase now defaults to `'manual'`) because it would hang indefinitely on many machines with no reliable timeout signal. The manual vegetable picker is the reliable default; it is not backed by any search API, just the bundled `VEG_CATALOG`.

### Orders, receipts, and history

- [ ] Frontend's order history (`frontend/src/stores/orders.ts`: shop, lines, total/market/savings cents, fairness, proof-verified flag, fulfillment tracker, payment status) persists multiple orders across multiple shops and sessions. The backend has no `orders` table and no `GET /v1/orders` endpoint (handoff §4) — its `negotiations` table is the closest analog, but it's one row per single negotiation, not an order with multiple line items from one basket checkout.
- [ ] The frontend's receipt UI, this session, grew a "printing" entrance animation and a savings celebration (a full-screen "money saved" splash on both the buyer's receipt and the seller's payment-received moment — `frontend/src/components/buyer/PayFlow.tsx`, `frontend/src/components/react/MoneySplash.tsx`, `frontend/src/lib/moneyEvents.ts`). These are purely cosmetic and need no backend support, but they do assume `Order.savingsCents`/`totalCents` exist and are correct the instant payment captures — worth keeping in mind if/when the backend becomes the source of truth for that timing.

### Payment (PayPal) — the closest-to-ready piece

- [ ] The backend's PayPal integration is comparatively solid and close to what the frontend expects: `backend/packages/paypal/` has a real Orders v2 client with idempotent capture (`PayPal-Request-Id`), real webhook signature self-verification (`backend/packages/paypal/src/webhook.ts`), and the route sequence (`backend/apps/api/src/routes.ts`: `POST /v1/negotiations/:id/checkout` → `POST /v1/negotiations/:id/capture` → `POST /v1/webhooks/paypal`) matches the shape `frontend/docs/BE_HANDOFF.md` §6 describes (create → approve → capture → webhook-driven status).
- [ ] The frontend's `PayFlow.tsx` is still a fully local mock today — it fabricates an order id (`'order-' + Date.now().toString(36)`), fakes `order_created → approved → captured` with `setTimeout`s, and never calls PayPal or any backend. The handoff doc's proposed `PaymentGateway` interface (`createOrder`, `approve`, `capture`, `subscribe(status)`) is explicitly flagged there as *"not yet extracted (open item)"* — that extraction still hasn't happened.
- [ ] Endpoint path mismatch: handoff doc's proposed `POST /v1/checkout` (flat) vs. the backend's actual `POST /v1/negotiations/:id/checkout` (nested under the negotiation) — a small shape difference, but the FE's eventual `PaymentGateway` adapter needs to target the real path, not the doc's guess.
- [ ] Since the negotiation model itself needs to change (one deal → a basket of lines, above), the checkout/capture flow built against "one negotiation = one payment" will need to either checkout per-lane or be redesigned to checkout a whole basket in one PayPal order referencing multiple negotiation lines — not addressed anywhere yet.

### Transport: SSE vs WebSocket

- [ ] The backend streams negotiation events over **SSE** (`GET /v1/negotiations/:id/events`, `backend/apps/api/src/routes.ts`). The frontend's mock transport layer and `frontend/docs/BE_HANDOFF.md` (§1's swap table: *"Negotiation stream ... Real later: WS negotiation channel"*; §5's shop-status fan-out is also specced as WS) are both built around WebSocket (`frontend/src/lib/ws.ts`). These aren't hard to reconcile (SSE is simpler and one-directional, which is all a negotiation stream needs), but the frontend's `openSocket()` abstraction assumes a WS connection today and would need to become an `EventSource` consumer, or the backend would need to add a WS endpoint alongside SSE.
- [ ] Shop-status fan-out (a vendor opening/closing their stall, live to every buyer tab) is WS-only in the handoff doc's design (§5) and is currently a `BroadcastChannel` within one browser on the frontend (`frontend/src/stores/venue.ts`) — the backend has no equivalent channel of any kind, SSE or WS, since it has no shop entity to broadcast status for in the first place (see "Shops, vendors, and inventory" above).

### Security rules specified but not enforced server-side

- [ ] `frontend/docs/BE_HANDOFF.md` §8 requires the backend to strip seller-only `floorCents`/`minCents` from every buyer-facing response and event — moot today since there's no shop/inventory data flowing through the backend at all yet, but worth flagging before that data model is added, since it's easy to leak a floor price into a buyer payload by accident.
- [ ] §8 also calls for rate limiting (`/v1/auth/otp` per-IP, `/v1/negotiations` per-user for LLM cost, `/v1/inventory/snap` per-user) and idempotency beyond what already exists for PayPal capture. None of this exists in `backend/apps/api/src/routes.ts` today — not surprising at this stage, but worth a pass before any public demo URL is shared (the backend's own ADR 0005 commits to exactly that: *"a judge can hit a public URL and watch a negotiation run live"*).

### Explicitly NOT backend gaps (frontend-only, said here so they aren't mistaken for missing backend work)

- [ ] Voice narration (Cartesia-generated clips, `frontend/src/lib/voiceClips.ts`, `frontend/scripts/gen-voice.ts`) is entirely client-side, build-time generated audio. No backend involvement needed or expected.
- [ ] Discovery / map (Leaflet + browser `navigator.geolocation`, `frontend/src/components/discovery/LeafletMap.tsx`, `ShopDiscovery.tsx`) runs entirely client-side against seeded shop coordinates and the browser's real GPS. The backend's eventual `GET /v1/shops/nearby?lat&lng&radius` (handoff §4) would replace the seeded coordinate list, but the map rendering and geolocation itself stay frontend-only.
- [ ] Gamification UI — XP/badges/streaks/predictions, per `frontend/docs/BE_HANDOFF.md` §3, is explicitly called out there as *"not modelled yet"* and *"cosmetic and must never change prices."* Still true; no backend schema exists for it and none should block a demo.
