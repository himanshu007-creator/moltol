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
to `false` would not produce a working demo. One small, additive piece is
wired and verified live today — see "What's wired now" below — but it's
deliberately narrow, for exactly the reasons above.

**Update, later session:** the "no users, no shops, no sessions" line above is
now out of date — real auth (email + password + OTP) and basic shop/item CRUD
were built and wired end to end (see the "Auth, session, and the dual-role
account" and "Shops, vendors, and inventory" checklists below for the
specifics). The schema now has `users`, `otp_codes`, `shops`, and `shop_items`
alongside the original five tables. This narrows, but does not close, the
structural mismatch described above: the negotiation engine still doesn't
reference a real shop or a vendor-set floor price, so the core "one query →
one deal" vs. "basket of lanes against a real shop" gap is still exactly as
described. The SSE-vs-WebSocket mismatch mentioned below is now resolved too.

**Update, backend pass (2026-10-16):** the structural gap above is closed on the
backend side. A basket is now a real backend object: `POST /v1/baskets` haggles
every line against a real shop's real prices (a per-line reserve above the
vendor's `floorCents` sealed as the shop's limit, the list price as the buyer's ceiling), one negotiation per line
with `lineItemId` = that line's negotiation id, streamed over one SSE stream,
with human takeover / counter / accept / accept-all as server actions, one PayPal
order for the whole basket, a proof per line, and `GET /v1/orders`. Discovery
(`/v1/shops/nearby`), stall open/close with live fan-out, logout and session
revocation, rate limiting, and the role/preset preferences exist too. **The
frontend still runs on its mocks** — wiring `stores/bazaar.ts`, `PayFlow.tsx`,
`venue.ts` and discovery to these endpoints is the next (frontend) step. See
"Backend pass, 2026-10-16" below for the exact contract, what is deliberately
not done, and why.

<<<<<<< HEAD
## Current pending work (2026-10-24) — what's actually left, FE or BE

Everything below this line in the rest of the doc is the historical log (how
we got here, what was fixed, what was decided). This section is the answer
to "what's still pending, and on which side" as of today, pulled from that
log so nobody has to re-read 600 lines to find it. An item only appears here
if there is still something to build or decide — resolved items are left out
(see the checklist sections further down for the full done/not-done history
with dates).

**Big change this session: the frontend's entire local/seeded simulation is
gone.** Every seeded shop, the fake haggle engine, the zero-login demo
account, hardcoded Jalandhar coordinates, local ledger/insights math, and
the on-device vegetable-scanner catalogue have all been deleted outright
(not kept as a fallback). The app now runs on nothing but the real backend —
a brand-new visitor can only reach `/login`; every shop, item, haggle,
location, ledger number, and order is real. This is what makes the backend
gaps below concrete and newly load-bearing (they used to be hidden behind a
local fallback; now a seller hits them directly).

### Backend — pending

- [ ] **`archived` has no write path.** `CreateShopItemRequestSchema`/
  `UpdateShopItemRequestSchema` in `backend/packages/contracts/src/vendor.ts`
  never added `archived` — only the output `ShopItemSchema` has it. A vendor
  cannot archive/restore an item via the API. The frontend's Modern Inventory
  console (now real CRUD, see "Frontend — pending" below) has its
  archive/restore button disabled with an inline note pointing at this gap.
- [ ] **No bulk item endpoint.** CSV import and bulk price changes in the
  frontend's Modern console are now sequential individual `PATCH`/`POST
  /v1/shops/me/items` calls — correct, but slow for a large import. A real
  bulk endpoint would help but isn't required for correctness.
- [ ] **No photo/image storage on `shop_items` at all** — not even a
  seller-only field. The Modern Inventory item form's photo upload is a
  local-only preview that is never persisted; found this session when the
  inventory store was rewired to real CRUD. Same underlying gap as
  snap-to-add needing image hosting (see "Image / vision" below) — worth
  deciding together.
- [ ] **`locationUpdatedAt` (how fresh a "live" vendor pin is) is only
  returned by `GET /v1/shops/nearby`'s `nearbyView`, not by the single-shop
  `shopView`** (`GET /v1/shops/:shopId`, `GET /v1/shops/me`) — found while
  wiring the frontend's live-location badge. A buyer who lands straight on a
  stall URL (not through the nearby list) has no way to know if that shop's
  pin is live. Minor; the nearby list is the primary discovery path.
- [ ] **No "search products by name" endpoint.** The frontend's vendor
  "search by name" flow (`AddItem.tsx`) always returns empty results now —
  it used to fall back to a hardcoded local catalogue, which was removed
  this session along with everything else local. The real, wired part of
  that flow (`GET /v1/market/comps`, a price-range lookup for a typed
  query) still works; only the product-name/emoji suggestion list has
  nothing backing it.
- [ ] **SerpAPI/Channel3/LLM/SMTP keys are unset on the live instance** —
  ops/config, not missing code. Comps fall back to seed, snap to the
  catalogue, OTP to console-logging. Set in `terraform.tfvars` and re-apply.
- [ ] **`ALLOW_MOCK_PAYPAL`/sandbox buyer approval** still needs a manual
  click for a real PayPal run.
- [ ] **SerpAPI currency caveat:** SerpAPI results come back in the
  Google-locale currency (often USD), which can mismatch INR shops once the
  key is live — normalise or filter by `currency` when enabling.

### Frontend — pending

Done this session (2026-10-24) — the local-simulation-removal pass, verified
with `tsc`/`pnpm build` clean throughout:

- [x] **Local haggle simulation deleted** (`stores/bazaar.ts`) — every
  basket haggle is a real `POST /v1/baskets` + live SSE stream; a shop/item
  mix that isn't real shows a clear error instead of a fake haggle.
- [x] **Zero-login demo account deleted** (`DemoProvisioner.tsx`,
  `provisionDemo()` on both `stores/session.ts` and `stores/simple.ts`) — a
  fresh visitor now always lands on `/login`.
- [x] **Seeded shops/discovery deleted** — `useLiveShops()` returns only
  real backend shops; the hardcoded Jalandhar `BAZAAR_CENTER` fallback is
  gone, so a buyer's position is real GPS or nothing (an explicit "share
  your location" empty state, not a silent wrong default).
- [x] **New feature: live vendor location.** Wired the backend's
  already-built-but-unused `PATCH /v1/shops/me/location` (continuous push,
  distinct from the one-shot `PATCH /v1/shops/me`) as an opt-in toggle in
  Simple Mode ("Share live location while open") that pushes the seller's
  real position every few seconds via `watchPosition` while the stall is
  open; the buyer's discovery map and stall header show a "📡 live" badge
  off `locationUpdatedAt` when fresh (<2 min).
- [x] **Modern Inventory is now real CRUD** — `stores/inventory.ts` holds
  real `ShopItem[]` from `GET /v1/shops/me`; add/update/adjust/bulk/import
  are real `POST`/`PATCH` calls. `archived` and bulk import are disabled/
  sequential respectively, per the backend gaps above.
- [x] **Ledger, insights, and "ask your ledger" are now real-data-only** —
  no local fallback left. `LedgerDashboard.tsx` renders `GET /v1/ledger`'s
  KPIs, rankings (`widgets.marginByItem`/`revenueByItem`), and deal funnel
  directly; `Insights.tsx` renders `GET /v1/insights/buyer`'s real cards;
  `LedgerAsk.tsx` always calls the real `POST /v1/ledger/ask` agent.
- [x] **Snap-to-add unified onto the real backend, both surfaces.**
  `AddItem.tsx`'s Snap mode and Simple Mode's `VegetableScanner.tsx` (which
  used to run Chrome's experimental on-device `window.LanguageModel` against
  a hardcoded 20-item vegetable catalogue) both now capture a photo and call
  the real, authenticated `POST /v1/inventory/snap` — no local/offline
  fallback. `ProductCreationForm.tsx` now requires the real `addShopItem()`
  write to succeed before a product is added, instead of adding it locally
  regardless.
- [x] **PayFlow is now real-only** — the local mock `setTimeout`
  order-fabrication path is deleted; every payment is a real checkout/
  capture against the real basket.
- [x] **Simple Mode hydrates from the real shop** on login (`Shell.tsx`'s
  `GET /v1/me` sync now also calls `GET /v1/shops/me` and populates
  `stores/simple.ts`'s stall name/products), instead of a hardcoded starter
  product set.

Still pending:

- [ ] **AG Grid Studio's actual grid/widget UI** (margin-by-item bar,
  fairness histogram, deal funnel — all already computed and returned by
  `GET /v1/ledger`, rendered now as plain bars/numbers, not an AG Grid
  embed) — its own, separate, larger build. See "Hackathon sponsor
  integrations" below for the full scoped-out spec.
- [ ] **"Repeat customers" and a real "peak hours"/day-trend chart** were
  dropped from the old local ledger dashboard rather than rebuilt — the
  backend's `LedgerRow` carries no buyer identity at all (no real data
  possible for "repeat customers"), and a real trend-by-period chart would
  need new bucketing logic not yet built on the frontend. Not blocking;
  flagged here so it isn't mistaken for an oversight.
- [ ] Voice narration and gamification (XP/streaks/badges) are
  frontend-only by design and were never meant to need backend work —
  listed here only so they aren't mistaken for an oversight; no action
  needed.

Everything else — basket haggle, checkout/payment, orders/receipts,
discovery, stall status, live location, session/role/logout, ledger/
insights/ask, the seller live deal feed, snap-to-add, Modern Inventory CRUD,
and the INR→USD checkout display — is wired and verified end to end, with
no local fallback left anywhere in the app.

## Backend pass, 2026-10-16

### Built (all in `backend/`, contracts in `packages/contracts`)

| Frontend need | Endpoint(s) | Notes |
| --- | --- | --- |
| Basket haggle (`bazaar.start`) | `POST /v1/baskets` `{shopId, lines:[{itemId, qty}], request:{rounds, tone, preset}}` → `Basket` | `itemId` is the backend `shop_items` id (the FE's `sku` for a real shop). `rounds` 2–12; `tone` polite/playful/firm sets how fast the buyer agent concedes. Shop must be open; qty must fit the unit (≤ 3 dp for kg/g/litre/ml, whole otherwise) and the stock. |
| Lane stream (`buildCartScript` / `playEvents`) | `GET /v1/baskets/:id/events` (SSE) | Every lane's public events on one stream; route by `negotiationId` (= `lineItemId`). Paced ~0.9 s per turn (`TURN_DELAY_MS`). Resumes from `Last-Event-ID`. Event shapes: `NegotiationEventSchema` in `packages/contracts/src/events.ts` (the FE's `lib/events.ts` differs: nested `turn`, `limits.sealed` instead of two `commit.recorded`, plus `verdict`/`control.changed` — the FE needs a small adapter). |
| `takeOver` / `humanOffer` / `acceptLane` / `acceptAll` | `POST /v1/baskets/:id/lines/:lineItemId/takeover`, `…/offer {priceCents}`, `…/accept`, `POST /v1/baskets/:id/accept-all` | Offers are guarded by the buyer's sealed ceiling (422 above it); an offer at/above the shop's ask takes the ask. The shop never walks away from a human — it holds its last concession until accepted. |
| Basket state for the summary/bill | `GET /v1/baskets/:id` | Per line: `askCents`, `agreedUnitCents`, `agreedLineCents = round(unit × qty)`, `listLineCents`, `market`; totals. |
| `PayFlow` | `POST /v1/baskets/:id/checkout` → `{paypalOrderId, approveUrl}` → PayPal approval → `POST /v1/baskets/:id/capture` → `{proofs}` | One PayPal order per basket. Without PayPal keys the mock gateway returns `approveUrl: null` — capture directly. Webhooks settle too (approval is captured server-side if the callback is lost). |
| Proof reveal | `proof.revealed` on the stream; `GET /v1/baskets/:id/proof` | After payment only. Carries `reveal {buyerLimitCents, buyerSalt, shopFloorCents, shopSalt}` (`shopFloorCents` = the line's sealed reserve, not the vendor's floor) so the FE can recompute the commitments (`commitmentPayload` in `packages/policy/src/crypto.ts`, isomorphic). |
| `useOrders` | `GET /v1/orders`, `GET /v1/orders/:id` | A checked-out basket in the FE's `Order` vocabulary (`totalCents`, `listCents`, `marketCents`, `savingsCents`, `fairness`, `proofVerified`, `paymentStatus`). |
| Seller ledger data (`useLedger`) | `GET /v1/shops/me/deals?since=` | Every line of every paid basket at the seller's shop. |
| Discovery (`ShopDiscovery`) | `GET /v1/shops/nearby?lat&lng&radiusM` | Open stalls by distance, closed last. Location set via `POST`/`PATCH /v1/shops/me {location:{lat,lng}}`. |
| Stall status (`useVenue`) | `PUT /v1/shops/me/status {open, closeInMin?, reopenInMin?}`, `GET /v1/shops/status/stream` (SSE `shop.status`) | Same `{open, closeAt, reopenAt}` (epoch ms) shape as `StallStatus`; due timers are applied server-side on read. |
| `switchRole`, `setPersonality` | `PATCH /v1/me/role`, `PUT /v1/me/preferences/haggle`; both returned by `GET /v1/me` | View preferences only; a role never changes what a token may do. |
| Logout | `POST /v1/auth/logout` | Revokes that session. Tokens now expire (`JWT_TTL`, 7 d); a password reset revokes every session. Tokens issued before this pass never expired and are now refused — users log in once more. |

### Answers to `frontend/docs/BE_HANDOFF.md`'s open questions

1. **`lineItemId` per cart line?** Yes — and each line is its own negotiation under a basket id; `lineItemId` is that negotiation's id.
2. **Who owns `shop.status` fan-out?** The API (Redis pub/sub → SSE `/v1/shops/status/stream`).
3. **Vision?** Not built — see "Not done" below.
4. **Comps provider?** Still Channel3-or-seeded; undecided — see below.
5. **Does `rounds` shorten the stream?** Yes: `rounds` is the line's `roundsMax`, so fewer rounds = fewer turns (and a smaller discount).
6. **Is `minCents` sent in plaintext?** The vendor sends `floorCents` to the API (owner-only). It never leaves the server: each line seals a random reserve above it, and buyers only see that reserve's commitment, then the reserve itself after paying.

### Not done, and why

- **Wiring the frontend.** Out of scope for a backend pass; the endpoints above are the contract. The FE also needs an adapter for the event union (see the stream row).
- **"Modern" inventory** (cost price, low-stock threshold, archive, bulk edit, CSV import, adjust-with-reason): a bigger schema and a different shape from `shop_items`. Only the overlap moved: fractional stock for weight/volume units and the FE's `list ≥ lowest` rule.
- **Live seller offer feed (`deal.incoming`):** in the backend model the shop's agent haggles for the vendor, so there is no seller accept step to drive; a seller-private stream also needs a stream-ticket design (an `EventSource` can't send an auth header). Sellers can read `/v1/shops/me/deals`.
- **Server-side insights/ledger analytics:** the inputs now exist (`/v1/orders`, `/v1/shops/me/deals`); the FE's `computeLedger`/`Insights` can run over them. Moving the maths server-side is not needed for the demo.
- **Comps provider:** no SerpAPI client was added — it can't be verified here without a key. The seeded fallback now centres on the item's own list price for basket lines (so a ₹40 tomato isn't benchmarked against a $18–$40 band). `createMarketProvider` is the place for a second provider once someone decides.
- **PayPal in INR:** shops price in `DEFAULT_CURRENCY` (INR by default, matching the FE). PayPal doesn't settle INR for merchants (it ended domestic payments in India), so a real sandbox order in INR is expected to be refused (`502 payment_provider_error`). Product decision needed: demo in USD, or convert at checkout. The mock gateway works in any currency.
- **Vision / snap-to-add:** needs image hosting plus a vision provider; not started.
- **Live vendor location while moving:** shops have a fixed, editable location now; continuous position sharing is a consent/privacy decision first.

### Independent review of this pass, and what's still open

A second, independent review of this pass found more issues. **Fixed before merge:**
- A webhook is now only a trigger: the API re-asks PayPal (idempotent capture) and settles only a capture PayPal reports `COMPLETED`. A webhook body is never trusted, so CRC-32 games on a simulator signature can't settle anything.
- `PENDING` captures wait (202) and `DECLINED` ones fail the payment.
- The shop's sealed limit per line is now a random reserve above the vendor's floor. The shop's deterministic concession curve made its counters invertible, which pinned the floor to within ₹1–2 from one free haggle; and the proof revealed it to any paying buyer, even for a 0-paise line.
- Every guard verdict is public and identical in shape, so a rejected number can't bracket a limit.
- A checkout interrupted halfway now recovers.
- Production refuses the mock gateway unless `ALLOW_MOCK_PAYMENTS=true`.
- Human-controlled lanes get 30 minutes before the sweeper times them out, instead of 5.
- Line totals use exact integer arithmetic.
- Each line must carry at least one whole unit of sticker value.
- The secure JSON parser is back.
- SSE routes no longer answer `HEAD`.
- Stock is `numeric(15,3)`, so any old integer value migrates.

**Still open (deliberately left for later):**
- **Payment retries:** a denied or expired PayPal order can't be retried; the buyer starts a new basket.
- **Stock:** there is no reservation between checkout and capture. Two buyers can pay for the last unit, and the overshoot is clamped to 0 (`markBasketPaid` returns the oversold items, but nothing surfaces them yet).
- **Capture before approval:** if the frontend calls capture before PayPal approval, PayPal may cache the `ORDER_NOT_APPROVED` answer for that `PayPal-Request-Id`. Only call capture after `onApprove`. A read-the-order-first step would remove the risk. **Frontend side now respects this (2026-10-18):** `PayFlow.tsx`'s `finishCapture()` only runs immediately when `approveUrl` is `null` (the mock gateway, nothing to approve); when a real `approveUrl` comes back, capture waits for the buyer to click "I've approved it on PayPal" after the popup. The backend-side risk (no read-the-order-first guard) is unchanged.
- **Frontend totals:** ~~the frontend computes line totals with a float multiply.~~ **Done (2026-10-18):** `stores/bazaar.ts` now takes `listCents`/totals from the basket response (`bl.listLineCents`, `agreedLineCents` via the reducer) for every real lane; the float multiply only remains for the local-simulation fallback, which has no backend numbers to take instead.
- **Standalone negotiations** (`/v1/negotiations/*`, the original agent-vs-agent demo) are public by design. Their shop's floor is now derived from a secret salt rather than the public negotiation id.

### Backend bugs fixed along the way

- PayPal webhooks: with `PAYPAL_WEBHOOK_ID` unset, any request with the five headers was accepted in sandbox (a forged `PAYMENT.CAPTURE.COMPLETED` could mark an order paid). Simulator events are now verified like any other, with PayPal's documented id `WEBHOOK_ID`. The route also read the raw body from the wrong object, so genuine webhooks were checked against re-serialized JSON.
- JWTs never expired; a password reset didn't sign anyone out; `JWT_SECRET` silently fell back to a committed dev string (Terraform now generates one; production refuses to start without it).
- `GET …/proof` revealed both limits right after agreement (before payment) and appended a new event on every call.
- Limits leaked mid-haggle: `deal.agreed` published `fairness` (solvable for the other side's limit), the shop's guard used the buyer's private mandate (public verdicts said "exceeds buyer mandate"), the buyer's final round jumped to its own ceiling (overpaying and announcing it), and the opening anchor never went below half the mandate (a generous buyer overpaid).
- Prices rounded to whole units could land past a non-round limit, and the guard's fallback reused that price.
- Event log: seq allocation wasn't atomic, and a unique index on (negotiation, timestamp) could silently drop an event; SSE could lose events published during its backfill, ignored `Last-Event-ID`, and sent no CORS headers on the stream.
- Malformed ids returned 500s; an OTP could be consumed twice; the timeout sweeper wrote events even when it didn't change the state and never swept negotiations stuck before their first step.

## What's wired now

Two pieces are genuinely connected and verified live (not just read from
source) as of this document's most recent update:

1. Real auth + vendor registration, described in the two checklist sections
   below — this is the bigger addition.
2. The original, narrower one, unchanged since it was written: the
   vendor's "search by name" flow (`frontend/src/components/vendor/AddItem.tsx`)
   now calls the real backend's `GET /v1/market/comps` alongside its existing
   SerpAPI search, through a new fallback-safe client
   (`frontend/src/lib/backend.ts`, gated by `PUBLIC_BACKEND_BASE`) and shows a
   "Live backend market" price band when the backend answers. This was tested
   against the real backend running via `docker compose up -d --build` in
   `backend/` (Postgres + Redis + API + worker + Caddy, zero external API keys
   needed — Channel3/LLM/PayPal/SEAL_KEY all have safe local fallbacks) with CORS
   open (`CORS_ORIGIN=*`), and it works end to end. It was intentionally the
   *only* thing wired at the time: an additive, clearly-labeled price check,
   without pretending the negotiation or shop/inventory mismatches of that
   moment didn't exist. The auth/vendor-registration work above is the first
   thing wired deeper than that — but it still deliberately stops short of the
   negotiation flow itself (see item 1's note on what's still out of scope):
   wiring checkout or the negotiation engine before the basket/lane model gap
   is resolved would produce a demo that silently does the wrong thing, which
   is worse than not wiring it at all.
3. **2026-10-18: the basket/lane gap above is now resolved — full basket
   haggle, checkout, and orders are wired end to end.** PR #3
   (`feat/backend-basket-haggle`) built the real thing this doc's item 2 was
   waiting on: `POST /v1/baskets`, one SSE stream per basket
   (`GET /v1/baskets/:id/events`), real takeover/offer/accept/accept-all,
   `checkout`/`capture` against the mock-or-real PayPal gateway, `GET
   /v1/orders`, `GET /v1/shops/nearby` + `GET /v1/shops/:id` for discovery,
   `GET /v1/shops/status/stream` for live open/close, and the role/haggle-
   preset/logout session endpoints. The frontend now drives all of it: when a
   buyer picks a real shop (tagged `backendShopId`/`backendItemId` — seeded
   demo shops are untouched and still haggle locally), `stores/bazaar.ts`
   creates a real basket and the whole theatre (`BazaarTheatre.tsx`,
   `HaggleChart.tsx`) is driven live by the SSE stream through the same
   reducer (`lib/negotiation.ts`) the local simulation uses, now rewritten to
   match the backend's event contracts byte-for-byte. `PayFlow.tsx` checks
   out and captures for real; `stores/orders.ts`/`ReceiptView.tsx` render the
   backend's own `Order`. Verified with a real, scripted end-to-end run
   against `docker compose up -d --build` (not just read from source): seller
   signup → shop + item + location → buyer signup → real shop shows up on
   `/app/buy` → real item in the stall → live SSE-driven haggle → real
   takeover/accept → checkout → capture → a real order with a verified proof
   hash lands on `/app/orders` and the receipt. Two real frontend bugs were
   found and fixed in the process (both were silent-wrong-data bugs, not
   crashes): `StallGrid.tsx`/`CartSheet.tsx` could silently substitute an
   unrelated seeded shop if a buyer hard-reloaded straight onto a stall or
   cart URL before the discovery page's in-memory fetch had ever run (no
   persistence on `useRealShops` — fixed with a direct-fetch fallback keyed
   off the shop id looking like a real UUID); and the bill/receipt's "Sticker
   price" row was reading the market median (`totalMarketCents`) instead of
   the item's actual list price (`totalListCents`), showing the wrong
   struck-through number.

## Frontend flow map (orientation for whoever picks up backend work next)

The frontend itself is in good shape — a separate audit (`FE_MISSING_THINGS.md`,
since folded back into this doc) confirmed all 27 pages render real content,
fixed the few purely-frontend issues it found (a receipt page that showed
static demo data instead of the real order, some orphaned pre-basket
negotiation code, two real accessibility bugs, one honesty-in-copy fix), and
extended the accessibility test suite from 7 to 19 pages. **What's left from
here on is backend work and wiring the frontend to it** — this section is a
flow-by-flow map of what the frontend does today and exactly what it would
need from the backend to become real, so that work can start from a clear
picture instead of re-deriving it from the frontend source each time.

**Auth (done).** Email + password + OTP, real backend, real session. See
"Auth, session, and the dual-role account" below — nothing left here except
the two small `[ ]` items in that section.

**Vendor registration / shop setup (done, narrow).** Real `shops`/`shop_items`
CRUD, dual-written from Simple Mode. See "Shops, vendors, and inventory"
below for what's in vs. deliberately out (the richer "Modern" inventory
model, nearby/discovery, stall open/closed fan-out).

**Buyer basket haggle** (`/app/stall` → `/app/bazaar` → `/app/cart` →
`/app/checkout`) — the core loop, still entirely client-simulated.
`stores/bazaar.ts` runs N parallel lanes (one per basket item) against a
script generated by `lib/mock/seeds.ts`'s `buildCartScript()` — no network
call anywhere in this path. To make it real: the backend needs the
basket/lane negotiation model described in "The negotiation primitive"
below (shop-scoped, multi-line, not the current one-query-one-deal shape),
and the frontend's transport seam is already half-built for whenever that
exists — `lib/ws.ts`'s `EventSource` consumer (built this session,
currently only used by the orphaned single-item path and now deleted along
with it) would need to be re-pointed at `bazaar.ts`'s lanes, one SSE stream
per lane or one multiplexed stream keyed by `lineItemId`, once that
contract exists server-side.
**"Bulk haggle"**, if that's ever asked about again: there isn't a separate
feature to find — `acceptAll()` in the same store is just "resolve every
still-open lane at once," same client-simulation, no distinct backend
surface of its own.

**Payment** (`PayFlow.tsx`, inside `/app/checkout`) — fully mocked, fabricates
an order id and fakes PayPal's `order_created → approved → captured` with
`setTimeout`s. The backend's real PayPal integration (`backend/packages/paypal/`)
is comparatively ready — see "Payment (PayPal)" below for the exact wiring
gap (a `PaymentGateway` interface was proposed but never extracted
frontend-side).

**Orders & receipts** (`/app/orders`, `/app/receipt`) — `stores/orders.ts`
persists completed orders to IndexedDB only; `/app/receipt?order=<id>` (the
query param was added this pass, fixing a real bug where it ignored which
order you'd clicked and always showed fixture data) reads from that same
local store. No backend `orders` table or endpoint exists — see "Orders,
receipts, and history" below. A `HashVerify` settlement-hash display is
already built and reused from the checkout screen; it's a real SHA-256 of
the order's own numbers computed client-side, not a backend-issued proof —
worth deciding whether a real proof should come from the server once orders
are backend-owned.

**Seller ledger & insights** (`/app/seller/ledger`, `/app/insights`) — both
fully local computations (`lib/ledger.ts`'s `computeLedger()`,
`Insights.tsx`) over seeded/local data. Nothing backend-side to build on top
of yet (no `deals`/`orders` history server-side) — see "More missing APIs"
below for the three endpoints this would need (`/v1/ledger`, `/v1/deals`,
`/v1/insights/buyer`). The "Quick ledger lookups" box on the ledger page
(this pass's renamed "Ask your ledger") is local keyword-matching, not AI —
if a real natural-language ledger query is ever wanted, `packages/llm`
already exists and is the natural place to wire it from.

**Discovery / map** (`/app/buy`, `ShopDiscovery.tsx`, `LeafletMap.tsx`) —
**wired 2026-10-18**: real shops with a location set (`frontend/src/stores/realShops.ts`
calls `GET /v1/shops/nearby`) now show up alongside the seeded pins, tagged
`backendShopId`; a seller sets their real pin once via `StallHome.tsx`'s new
"Set my location on the map" button (`PATCH /v1/shops/me`, one-time
`getCurrentPosition()`, not `watchPosition` — see below, this is not the
live-tracking feature). The buyer's own position is still real,
continuously-tracked GPS (`watchPosition`) same as before. See "Live vendor
location on the map" below for why continuous vendor-side movement is still
a separate, not-yet-built feature.

**Vendor console** (`/app/seller/inventory`, `AddItem.tsx`,
`InventoryManager.tsx`) — the richer "Modern" inventory model (cost/min/list
prices, CSV import, bulk edit, archive/restore), distinct from the Simple
Mode stall this session wired to the backend. Deliberately left unwired —
see "Shops, vendors, and inventory" below for why (different shape than
`shop_items`, bigger scope).

**Voice narration, gamification** — frontend-only by design, no backend
needed or expected; listed under "Explicitly NOT backend gaps" at the
bottom so they aren't mistaken for an oversight.

## Checklist

### Auth, session, and the dual-role account

- [x] **Real auth now exists, email + password + 6-digit email OTP.** `backend/packages/store/src/schema.ts` gained `users`, `otp_codes`, `shops`, `shop_items` tables (migrations `0002`/`0003`). Routes live in `backend/apps/api/src/auth-routes.ts`: `POST /v1/auth/signup`, `POST /v1/auth/otp/verify`, `POST /v1/auth/otp/resend`, `POST /v1/auth/login`, `POST /v1/auth/password/forgot`, `POST /v1/auth/password/reset`, `GET /v1/me` (JWT-protected via `@fastify/jwt`). Passwords are hashed with Node's built-in `scrypt` (`apps/api/src/password.ts`); OTP codes are sha256-hashed, 10-minute TTL, 5 max attempts, 45s resend cooldown, purpose-scoped (`signup` vs `reset` — a signup code can't be replayed to reset a password, verified in testing). Email is normalized before signup the way the product asked (`packages/contracts/src/email.ts` `normalizeEmail()` — Gmail-style dot/`+tag` stripping, `googlemail.com`→`gmail.com`; `himanshu+123@gmail.com` → `himanshu@gmail.com`), and the signup response tells the caller which address will actually receive the code. Duplicate signups are handled explicitly (409 if already verified, silent resend if the previous signup was abandoned unverified).
- [x] Frontend (`frontend/src/components/buyer/AuthForm.tsx`) was fully rewritten off the old phone+hardcoded-`1234` mock (`frontend/src/lib/mock/auth.ts`, deleted) onto this real backend via a new typed client in `frontend/src/lib/backend.ts` (`signup`, `verifySignupOtp`, `resendSignupOtp`, `login`, `forgotPassword`, `resetPassword`, `me`). 6 OTP boxes (was 4), password + confirm-password fields, a "Forgot password?" flow, and the normalized-email notice are all live and were verified end to end against the real running backend (signup → OTP → login → wrong-password rejection → forgot/reset → re-login), not just typechecked.
- [x] `frontend/src/stores/session.ts` gained `token`/`email` fields and a `loginWithBackend()` action (persist store version bumped to 4) for the real JWT session, kept alongside — not replacing — the existing local-only `provisionDemo()` demo account, which is untouched and still phone/name-based for quick no-backend testing.
- [x] **Done (2026-10-16):** `PATCH /v1/me/role` (and `PUT /v1/me/preferences/haggle`). Original note: `PATCH /v1/me/role` (switching `activeRole` server-side) is still not built — `activeRole` stays frontend-only/local, same as before. Not needed for the auth flow to be real end to end, but still a gap if the backend ever needs to know which role is active.
- [x] **Done (2026-10-16):** `POST /v1/auth/logout` revokes the session; tokens expire; a password reset revokes all sessions. Original note: Logout is still purely client-side (no `/v1/auth/logout` or token revocation) — the JWT is just dropped locally. Fine for a hackathon (short-lived enough token, nothing sensitive persists server-side per session), but a real revocation list would be needed for anything beyond a demo.
- [ ] Email delivery: the OTP emails are real HTML templates (`backend/apps/api/src/emails/`) sent via SMTP (`nodemailer`, configured for Brevo's free relay — see `.env.example`'s `SMTP_*`/`EMAIL_FROM` vars). Without `SMTP_USER`/`SMTP_PASSWORD` set, the code is logged to the API's console instead of emailed (same graceful-degrade pattern as Channel3/LLM/PayPal) — useful for CI/local dev, but means a fresh deploy needs those two env vars set before OTP delivery actually works for real users.

### Shops, vendors, and inventory

- [x] **Basic shop + item CRUD now exists**, scoped to what "vendor registration and shop setup" actually needs. `shops` (one per user, `userId` unique) and `shop_items` (`sellCents`/`floorCents`/`quantity`/`unit`/`hindiName`) tables, routes in `backend/apps/api/src/shop-routes.ts`: `POST /v1/shops/me` (idempotent create-or-return, called automatically on a fresh seller signup from `AuthForm.tsx`), `GET /v1/shops/me` (owner view, includes `floorCents`), `POST/PATCH/DELETE /v1/shops/me/items(/:id)`, and `GET /v1/shops/:id` (public, buyer-facing — `floorCents` stripped via `PublicShopItemSchema`/`toPublicShopItem()`, the one place the "seller-only numbers never leak to a buyer" rule from the Security section below is actually enforced today).
- [x] Frontend's **Simple Mode** stall (`frontend/src/stores/simple.ts`) is now dual-written to this backend: `ProductCreationForm.tsx` calls `addShopItem()` after a local `addProduct()` and stores the returned id back onto the product (`SimpleProduct.backendItemId`); `SimplePrice.tsx` debounces `updateShopItem()` calls (the price slider fires continuously — synced 600ms after the user stops dragging, not per tick) keyed off that id. Local IndexedDB stays the source of truth for the UI either way — a failed backend write never blocks the seller's local flow, same fail-soft pattern as the market-comps call.
- [ ] **Not done**: the richer "Modern" inventory model (`frontend/src/stores/inventory.ts`, `frontend/src/components/vendor/{AddItem,InventoryManager}.tsx` — cost/min/list prices, low-stock threshold, archived flag, bulk edit, CSV import, adjust-with-reason/undo) is a different, larger shape than what `shop_items` supports and was deliberately left unwired this pass — extending it would mean either mapping only the overlapping fields (lossy) or growing the schema further (a separate, bigger piece of work, not "vendor registration").
- [x] **Done (2026-10-16):** `GET /v1/shops/nearby` + shop `location`. Original note: No `GET /v1/shops/nearby` (discovery) — `frontend/src/components/discovery/{LeafletMap,ShopDiscovery}.tsx` still run entirely against seeded coordinates, unchanged.
- [x] **Done (2026-10-16):** `PUT /v1/shops/me/status` + SSE `/v1/shops/status/stream`. Original note: A vendor opening/closing their stall (`frontend/src/stores/venue.ts`'s `StallStatus`, synced only via `BroadcastChannel` within one browser) still has no backend equivalent.
- [x] **Done (2026-10-16):** basket lines haggle against the item's real list price and the vendor's sealed `floorCents`. Original note: The backend's negotiation engine still does not reference a real shop or a real item — `deriveShop()` (`backend/packages/engine/src/baseline.ts`) still synthesizes a floor/open price from market comps, seeded by `negotiationId`, entirely fictional. The new `shop_items.floorCents` a vendor actually sets is not wired into the negotiation engine at all — that's the "one query → one deal" vs. "basket of lanes against a real shop" mismatch described below, intentionally out of scope for this auth/vendor-registration pass.

### The negotiation primitive: one deal vs. a basket of parallel lanes

- [x] **Done (2026-10-16):** `POST /v1/baskets` (`CreateBasketSchema`). Original note: Backend's `CreateNegotiationSchema` (`backend/packages/contracts/src/negotiation.ts`) takes one `query` string and produces one negotiation with one outcome. The frontend's basket haggle (`frontend/src/stores/bazaar.ts` `start()`) runs one negotiation **lane per cart line** in parallel against one chosen shop, each with its own turns/price/outcome.
- [x] **Done (2026-10-16):** `lineItemId` = the line's negotiation id. Original note: `frontend/docs/BE_HANDOFF.md` §3 names this exact gap: *"the union is one negotiation per stream. The FE runs one lane per item (Lane.sku, Lane.itemId). Add lineItemId to every event (turn, deal.agreed, session.ended) and one session per line item under a cart-level negotiationId."* This has not been done — `lineItemId` does not appear anywhere in `backend/packages/contracts/`.
- [x] **Done (2026-10-16), at `POST /v1/baskets`** (`itemId` instead of `sku`). Original note: `POST /v1/negotiations` per the handoff doc should accept `{shopId, lines: [{sku, qty}], scope, request, budgetCents?}` and return `{negotiationId, lines: [{lineItemId, sku}]}`. The backend's actual endpoint accepts `{query, persona, maxTotalCents, currency, roundsMax}` — a different shape entirely, with no `shopId` or `lines`.
- [x] **Done (2026-10-16):** takeover / offer / accept per lane. Original note: Per-lane manual control — "take over a lane" and make a human offer mid-negotiation — is a real frontend feature (`frontend/src/stores/bazaar.ts` `takeOver()`, `humanOffer()`, tested in `tests/buyer-flow.spec.ts`). The backend's state machine and event vocabulary (`backend/packages/contracts/src/negotiation.ts` `STATE_TRANSITIONS`) have no state or event for a human taking control mid-run, and the handoff doc's proposed endpoints for it (`POST /v1/negotiations/:id/lines/:lineItemId/takeover`, `.../offer`) don't exist.
- [x] **Done (2026-10-16):** `POST /v1/baskets/:id/accept-all`. Original note: "Accept all" (settle every still-live lane at once) is a frontend action (`bazaar.ts` `acceptAll()`) with a proposed `POST /v1/negotiations/:id/accept-all` endpoint (handoff §4) that doesn't exist backend-side.
- [x] **Stale, superseded 2026-10-18:** the note below described `acceptAll()` as always a local client-side force-resolve, with no distinct backend surface. That's no longer true — for a real basket it now calls the real `POST /v1/baskets/:id/accept-all` from the checklist row above; the local-only path stays for seeded demo shops with no `backendShopId`. Original note, now historical: Re-audited a prior session, specifically for a "bulk haggle" gap: confirmed there isn't a second, separate bulk mechanism to document — `acceptAll()` (`bazaar.ts:218-220`) iterates every non-settled lane and force-resolves each to its last known price, entirely client-side; `tests/buyer-flow.spec.ts`'s "haggle all" test exercises exactly this path end to end.

### Negotiation outcome semantics (no-deal vs. always-converge)

- [ ] This session, the frontend's negotiation simulator was deliberately rewritten so a haggle **always** ends in an agreed price — the buyer and shop's offers now monotonically converge every round (`frontend/src/lib/mock/seeds.ts` `buildScript()`), and the old "buyer can't make the floor, so no deal" organic failure mode was removed, on the reasoning that haggling over an item already in your basket should resolve to a price, not a walk-away. The product copy and UI (`BazaarTheatre.tsx`'s old "NO DEAL" chip and the no-deal-count banner) were built around the possibility of a no-deal lane, so they're now effectively dead paths on the frontend, kept only for the human-abandons-a-takeover edge case.
- [x] **Resolved (2026-10-16):** basket lines always close (buyer ceiling = list price ≥ vendor floor); only the standalone demo can still end `no_zopa`, and its shop now walks away without naming its floor. Original note: The backend disagrees: `runHaggle()` (`backend/packages/engine/src/run-haggle.ts`) can and does organically end with `session.ended { reason: "no_zopa" }` whenever the buyer's concession curve doesn't reach the shop's floor within `roundsMax` — this is a real, reachable code path, not a hypothetical. Someone needs to decide: does the backend adopt the frontend's "always converge" stance (tune `deriveShop()`'s floor generation and/or the concession curves in `backend/packages/policy/src/concessions.ts` so ZOPA failure can't happen), or does the frontend's "always a deal" decision get walked back once it's talking to a backend that can genuinely say no? Shipping the two halves together without resolving this means the demo's behavior depends on which engine is running.

### Market comps provider

- [x] The frontend now *also* calls the backend's comps endpoint directly, additively (see "What's wired now" above, `frontend/src/lib/backend.ts` `backendComps()`) — shown as a third, clearly-labeled "Live backend market" price band next to the existing SerpAPI/catalogue results in the vendor's search-by-name flow. This doesn't resolve the provider disagreement below, it just surfaces both side by side so the mismatch is visible instead of silent.
- [ ] Backend calls **Channel3** for market comps (`backend/packages/market/src/channel3.ts`, wired via `CHANNEL3_API_KEY` in `backend/apps/worker/src/index.ts`), with a seeded fallback when no key is configured.
- [ ] Frontend is built and tested against **SerpAPI** (Google Shopping) for the equivalent lookup — verified working end-to-end with a real key this session (`frontend/scripts/local-api.mjs`'s dev-only proxy, `frontend/src/lib/vision.ts` `searchItems()`, used by the vendor "search by name" flow and documented in `frontend/docs/BE_HANDOFF.md`'s mock-layer table: *"Market comps ... Real later: Channel3 / SerpAPI comps"*).
- [ ] `frontend/docs/BE_HANDOFF.md`'s open question #4 — *"Comps: Channel3 or SerpAPI Shopping for median/p25/p75?"* — was asked and never answered. Someone has to pick one (or support both behind `createMarketProvider`'s existing provider-swap pattern in `backend/packages/market/src/index.ts`, which already has the right shape for a second provider).
- [ ] Currency defaults disagree too: the backend's money contracts (`MoneySchema`, `CurrencySchema` in `backend/packages/contracts/src/money.ts`) default to `"USD"` and `formatMoney()` hardcodes a `$` symbol; the frontend is entirely ₹/INR (`frontend/src/lib/money.ts` uses `Intl.NumberFormat('en-IN', ...)`). Channel3's and SerpAPI's result currencies, and which one actually returns usable INR comps for an Indian bazaar, is itself an open question nobody has checked.

### Image / vision product recognition ("snap to add")

- [ ] Frontend's vendor "Snap to add" flow (`frontend/src/components/vendor/AddItem.tsx`, `frontend/src/lib/vision.ts` `detectItems()`) and Simple Mode's camera scanner (`frontend/src/components/simple/VegetableScanner.tsx`, now defaulting to a manual picker — see below) both document the same unresolved limitation: **a real photo-to-product Lens lookup needs the photo hosted at a public URL first**, and neither side has that. The frontend's dev proxy (`frontend/scripts/local-api.mjs`) always 503s the `/v1/inventory/snap` photo path for exactly this reason and falls back to an offline catalogue.
- [ ] This is not solely a frontend gap — the backend has no `/v1/inventory/snap` endpoint, no vision model integration, and no image upload/hosting story either (`frontend/docs/BE_HANDOFF.md`'s mock-layer table literally says *"Vision (snap): canned suggestions ... Real later: Vision model, SerpAPI Lens is an option"* — still open). Whoever builds this needs to solve image hosting (even a short-lived signed upload URL) before SerpAPI Lens or any vision model becomes usable.
- [ ] This session, Simple Mode's camera-based on-device-AI scan path (Chrome's experimental `window.LanguageModel`) was demoted from the default flow to an opt-in extra (`frontend/src/components/simple/VegetableScanner.tsx`, phase now defaults to `'manual'`) because it would hang indefinitely on many machines with no reliable timeout signal. The manual vegetable picker is the reliable default; it is not backed by any search API, just the bundled `VEG_CATALOG`.

### Orders, receipts, and history

- [x] **Done (2026-10-16):** `GET /v1/orders`, `GET /v1/orders/:id`. Original note: Frontend's order history (`frontend/src/stores/orders.ts`: shop, lines, total/market/savings cents, fairness, proof-verified flag, fulfillment tracker, payment status) persists multiple orders across multiple shops and sessions. The backend has no `orders` table and no `GET /v1/orders` endpoint (handoff §4) — its `negotiations` table is the closest analog, but it's one row per single negotiation, not an order with multiple line items from one basket checkout.
- [ ] The frontend's receipt UI, this session, grew a "printing" entrance animation and a savings celebration (a full-screen "money saved" splash on both the buyer's receipt and the seller's payment-received moment — `frontend/src/components/buyer/PayFlow.tsx`, `frontend/src/components/react/MoneySplash.tsx`, `frontend/src/lib/moneyEvents.ts`). These are purely cosmetic and need no backend support, but they do assume `Order.savingsCents`/`totalCents` exist and are correct the instant payment captures — worth keeping in mind if/when the backend becomes the source of truth for that timing.

### Payment (PayPal) — the closest-to-ready piece

- [x] The backend's PayPal integration is solid: `backend/packages/paypal/` has a real Orders v2 client with idempotent capture (`PayPal-Request-Id`) and real webhook signature self-verification (`backend/packages/paypal/src/webhook.ts`). (The route path in this bullet's original note, `POST /v1/negotiations/:id/checkout`, was the pre-basket shape and is stale — the real, now-wired route is `POST /v1/baskets/:id/checkout` → `/capture`, per the row below.)
- [x] **Done (2026-10-18):** `PayFlow.tsx` now calls the real `/v1/baskets/:id/checkout` → `/capture` for a real basket (local-mock `setTimeout` path kept, unchanged, for seeded demo shops) — see "What's wired now" item 3. The old `PaymentGateway`-interface extraction idea is moot; `pay()` just branches on `bz.basketId` instead.
- [x] (moot, see above) Endpoint path mismatch note — resolved by construction, since the frontend targets the real `/v1/baskets/:id/checkout` path directly rather than the handoff doc's guessed `/v1/checkout`.
- [x] **Done (2026-10-16, frontend-wired 2026-10-18):** one PayPal order per basket (`/v1/baskets/:id/checkout` → `/capture`). Original note: Since the negotiation model itself needs to change (one deal → a basket of lines, above), the checkout/capture flow built against "one negotiation = one payment" will need to either checkout per-lane or be redesigned to checkout a whole basket in one PayPal order referencing multiple negotiation lines — not addressed anywhere yet.

### Transport: SSE vs WebSocket

- [x] **Settled in principle, and now actually consumed — SSE, not WebSocket.** The backend streams negotiation events over SSE, now at the real `GET /v1/baskets/:id/events` (one stream, every lane, routed by `event.negotiationId`). `frontend/src/lib/basketStream.ts` (new, 2026-10-18) is the live `EventSource` consumer — `stores/bazaar.ts`'s `connectStream()` opens it once per real basket and feeds every frame through the same reducer the local simulation uses. The original note below is now out of date (the old single-item `openSocket()`/`HaggleTheatre.tsx` subtree it described was already deleted as orphaned); see "What's wired now" item 3 for the full picture.
- [x] **Done (2026-10-16):** SSE `GET /v1/shops/status/stream`. Original note: Shop-status fan-out (a vendor opening/closing their stall, live to every buyer tab) is still only a `BroadcastChannel` within one browser on the frontend (`frontend/src/stores/venue.ts`) — the backend has no equivalent channel of any kind, SSE or otherwise, since it has no shop-status concept yet (see "Shops, vendors, and inventory" above). Unrelated to the SSE/WS question itself, which is now settled.

### Security rules specified but not enforced server-side

- [x] `frontend/docs/BE_HANDOFF.md` §8's "strip seller-only numbers from buyer-facing payloads" rule is now actually enforced for the one place it applies today: `GET /v1/shops/:shopId` returns `PublicShopItemSchema`, which omits `floorCents` (`backend/packages/contracts/src/vendor.ts`). Still moot for the negotiation engine itself (no real shop data flows through it yet, per above).
- [x] **Done (2026-10-16):** Redis-backed rate limits — 10/min per IP on auth, 20/min per buyer on baskets, 300/min per IP overall. Original note: §8's rate-limiting ask is still not done for `/v1/negotiations` or `/v1/inventory/snap`. The new auth endpoints do have a *related* but narrower protection — a 45-second per-account resend cooldown on OTP codes (`apps/api/src/otp.ts`) — but that's spam/abuse resistance on resend, not IP-based rate limiting on `/v1/auth/*` as a whole. Worth a real pass before any public demo URL is shared.
- [x] **Done (2026-10-16):** production refuses to start without a real `JWT_SECRET`; Terraform generates one. Original note: New from this pass, worth flagging explicitly: `JWT_SECRET` defaults to a fixed, committed-in-source dev string (`apps/api/src/env.ts`) if the env var isn't set — fine for local/CI, but **must** be set to a real secret (`openssl rand -hex 32`) before any non-local deploy, or every JWT is forgeable.

### More missing APIs (full sweep, later session)

A later sweep cross-referenced every frontend store against `lib/backend.ts`
and the live route list (`routes.ts`/`auth-routes.ts`/`shop-routes.ts`) to
find endpoints the frontend genuinely needs but has never once called out to
a backend for — distinct from the bigger, already-documented gaps above
(negotiation lines, `/v1/shops/nearby`, classic `/v1/inventory/*`, `/v1/orders`,
`/v1/inventory/snap`, `PATCH /v1/me/role`, `PUT /v1/shops/:id/status`).

- [ ] **`GET /v1/insights/buyer`** — `frontend/src/components/buyer/Insights.tsx` computes all 7 insight cards (savings, streak, budget, nudges) client-side from local `Order[]`. No backend awareness at all; `lib/personality.ts` even comments that its time/savings numbers are "mock estimates, labelled as such in the UI."
- [ ] **`GET /v1/ledger?period=`** — `frontend/src/lib/ledger.ts`'s `computeLedger()` (a 321-line pure function) does the seller's full KPI/ranking/hint computation in-browser from local inventory + deal history (`frontend/src/pages/app/seller/ledger.astro`).
- [x] **Done (2026-10-16) as `GET /v1/shops/me/deals?since=`.** Original note: **`GET /v1/deals?since=`** — `frontend/src/stores/ledger.ts` seeds 90 days of deal history into IndexedDB (`lib/deals.ts`: *"Mock deals for the ledger + Simple Mode earnings"*); no backend table of historical deals exists (the closest is `negotiations`, one row per single negotiation, not a seller's deal ledger).
- [x] **Done (2026-10-16).** Original note: **`PUT /v1/me/preferences/haggle`** — `frontend/src/stores/buyer.ts`'s `setPersonality()` (a 17-line store) persists the buyer's chosen haggle-style preset only to IndexedDB; there's no field anywhere in the backend schema to hold it.
- [ ] **A seller's live incoming-offer feed** — `frontend/src/components/simple/SimpleDeals.tsx` expects a `deal.incoming`/`deal.closed` stream per `frontend/docs/BE_HANDOFF.md` §5 (sound/haptic triggers on a new offer). This is distinct from the shop-status fan-out already documented above — it's the seller's own dashboard watching their own shop's live negotiations — and has no backend channel of any kind today (would naturally ride the same SSE pattern `/v1/negotiations/:id/events` already uses, scoped per-shop instead of per-negotiation, once negotiations reference a real shop).
- [ ] **"Ask your ledger" isn't actually AI** — not a missing endpoint so much as a mislabeled one: `frontend/src/components/react/LedgerAsk.tsx`'s `respond(q)` is local keyword-matching against a local `DEALS` array (checks for substrings like "below"/"top"/"best"), not an LLM call, despite `ledger.ask`/`ledger.askPlaceholder` copy implying a natural-language query. If a real backend-driven ledger Q&A is ever built (`packages/llm` already exists and is wired for negotiation narration), this is the place it would plug in — worth deciding whether to build it for real or just stop implying it's AI.

### Live vendor location on the map — not started on either side

A buyer finding the nearest vendor on the discovery map and watching that
vendor's pin move live as they physically relocate (e.g. a mobile cart),
refreshed roughly every 3 seconds, was raised as a feature idea. Researched
the current state on both sides before scoping it — this is a clean
zero-to-build gap, not a wiring gap:

- [ ] **Backend has no location concept at all.** `backend/packages/store/src/schema.ts` has zero `lat`/`lng`/geo columns anywhere — the `shops` table added this session is `{id, userId, name, emoji, createdAt, updatedAt}` only. Nothing to add a polling endpoint on top of yet.
- [ ] **Frontend has no live-location pattern to extend, only a one-directional, local analog.** `ShopDiscovery.tsx` already does continuous geolocation tracking, but only for the *buyer's own* position (`navigator.geolocation.watchPosition(...)`, not a one-shot `getCurrentPosition`) — that position is never sent anywhere, just used to re-center the buyer's own map. Shop pins come from static seed data (`lib/mock/seeds.ts`'s `lat`/`lng`) and never change; `LeafletMap.tsx` re-renders pins reactively when its `pins` prop changes (proven by how a shop's open/closed flip already propagates into the map live via `useVenue`), so the *rendering* side would just work once fed real data — the gap is entirely in "where would live vendor coordinates come from."
- [ ] **No "poll the backend every N seconds" precedent exists in the frontend yet.** A full `setInterval` sweep found 7 call sites, all local-only (a UI countdown, a local clock advancing stall open/close timers, haggle-engine tick, payment-mock animation, etc.) — none call `fetch`. A 3-second backend poll for vendor position would be the first network-polling loop in the codebase, not a variation on something already proven.
- [ ] **What it would actually take**, if someone decides to build it: backend — `lat`/`lng` (+ `updatedAt`) columns on `shops`, a `PATCH /v1/shops/me/location` the vendor's own device calls while their stall is open, and `GET /v1/shops/nearby` (already a documented gap above) returning current coordinates; frontend — a `setInterval`-driven poll on the buyer's discovery page (3s, matching the ask) feeding `LeafletMap.tsx`'s existing reactive pin update, and on the vendor's side, either `watchPosition` while the Simple Mode dashboard tab is open (battery/privacy cost, only works while that tab is foregrounded) or an explicit "start sharing my location" toggle (likelier to be acceptable for a real vendor, closer to how ride-hailing apps ask). Worth deciding the toggle/consent question before building, since continuous background location of a small vendor's phone is a real privacy decision, not just an engineering one.

### Hackathon sponsor integrations

**Correction, 2026-10-18: the sponsor list does exist in the repo — found in
`frontend/plan.md`** (`# MolTol — PayPal AI Hackathon Master Plan`, §4
"Sponsor tools and how we use them" + §0's TL;DR table). An earlier pass of
this doc searched and reported finding nothing; that search missed this file.
`plan.md` is the original team planning doc (both FE and BE scope were
planned from it) — it is the authoritative source for what was actually
promised, not a guess. Full sponsor decision table, verbatim from
`frontend/plan.md:123-134`:

| Sponsor | What it is | Prize | Free access | Intended use | Decision | **Status today** |
| --- | --- | --- | --- | --- | --- | --- |
| **Channel3** | Normalized product data API, 100M+ products / 25k+ retailers. Has an MCP server. | $1.5k | Key via `trychannel3.com/developers`, 20,000 credits, promo `PAYPAL-HACKATHON-2026` | Market anchor: buyer agent opens with a real comparable price; receipt shows "vs market." | ✅ Core | **✅ Done.** Backend calls it (`backend/packages/market/src/channel3.ts`, `CHANNEL3_API_KEY`), with a seeded fallback when no key is set. |
| **AG Grid (AG Studio)** | Embedded analytics (dashboards/charts/grid) + the **Studio Agent Framework**. | $5k / $2k / $1k×3 | 45-day trial, boilerplate `paypaldev/hackathon-paypal-ag-grid-boilerplate` | **Merchant Ledger**: custom widgets (margin kept, fairness score, deal funnel) + a natural-language **"Ledger Agent"** ("show deals under floor this week") built on PayPal's `list_transactions`/`get_merchant_insights` reporting tools. | ✅ Core | **🟡 Data side fully built and wired (2026-10-21); the actual AG Grid/AG Studio UI library is still unbuilt.** `GET /v1/ledger`, `/v1/ledger/summary`, `POST /v1/ledger/ask` (real Ledger Agent, PayPal reporting tools included) all exist and are wired into the frontend (`LedgerDashboard.tsx`'s KPI strip, `LedgerAsk.tsx`) — verified live end to end. What's still missing is narrower now: installing `ag-grid-*`/AG Studio itself and building its themed grid/widget screen against the data these endpoints already return. See below. |
| **Render** | Cloud platform + **Workflows** (orchestrate many concurrent tasks). | Credits $1k/$750/$500 | $50 credits | Hosting (web/API/Postgres/KV) + each negotiation as a Workflow task, so many stalls haggle concurrently. | ✅ Core | **Not evaluated** — this is a deploy-target/infra decision, not application code; the stack currently runs on plain `docker compose` locally (see `backend/docker-compose.yml`, `backend/docs/adr/0005-hosting.md`). Whoever handles deployment should decide whether to actually host on Render for the submission (the credits + prize require it) or note honestly that it wasn't used. |
| **APIMatic** | Context Plugins / SDKs / docs generated from API contracts. | $1k×3 + 6mo Business | Free plan via sign-up | Feed the PayPal Context Plugin into the coding agent while building the PayPal gateway; optionally generate an SDK/docs portal from our own OpenAPI contract. | ✅ Dev-time | **Not a runtime integration** — it's a coding-tool aid, nothing to build into the product itself. No code gap; only relevant if the team wants to claim it for the prize, which would mean actually using the plugin during development and saying so in the writeup. |
| **Elastic** | Elasticsearch, hybrid/vector search, Agent Builder. | none listed | 14-day trial + 30-day extension, or self-host | Stretch: "deal memory" — index past deals, agents retrieve similar past negotiations to calibrate opening offers. | 🟡 P2 stretch | Not built. Optional, explicitly a stretch goal in the plan, not required for the core submission. |
| **Zapier MCP** | Actions across 9,000+ apps, incl. PayPal. | none listed | 14-day trial | Stretch: a Zap pings the shopkeeper on Slack/WhatsApp when a deal closes. | 🟡 P2 stretch | Not built. Same as above — optional polish. |
| **Bryntum** | Gantt/Scheduler/Calendar. | $1k×3 | 45-day trial | Considered for a "Standing Orders" delivery calendar. | ⚪ Skip (explicit, in the plan) | Not built, by design — plan's own reasoning: "would add a fourth UI library and dilute the story." No action needed. |
| **KERNEL** | Browser infra for agents. | none | $50 credits | — | ⚪ Skip (explicit) | Not needed. |
| **Astropods** | Agent deploy platform. | none | free tier | — | ⚪ Skip (explicit, Render used instead) | Not needed. |
| **Postman** | API platform. | none | free | Use PayPal's public collection for sandbox exploration; publish our own collection. | ⚪ Dev-only | Not done, low priority — publishing a Postman collection for the API is a nice-to-have, not a sponsor prize requirement (no prize listed for Postman in the plan). |

#### The narrowed gap: AG Grid Studio's actual UI — **the data side is done; the grid/widget library itself is not**

This was planned as a **✅ Core** sponsor integration (not optional), with its
own dedicated screen (`plan.md` §8.5 screen 7: "Merchant Ledger (AG Studio):
KPIs and widgets, with the 'Ask your ledger' agent") and its own prize
category (AG Grid: $5k/$2k/$1k×3). As of 2026-10-21, the **data and logic
side is fully real and verified live**:

- Backend: `GET /v1/ledger` (full grid rows + KPIs + widget aggregates —
  `marginByItem`, `revenueByItem`, `fairnessHistogram`, `dealFunnel`, all
  already computed server-side in `apps/api/src/ledger.ts`), `GET
  /v1/ledger/summary` (KPIs alone), and `POST /v1/ledger/ask` (a real Ledger
  Agent — `packages/llm/src/ledger-agent.ts` — grounded in the ledger data
  plus PayPal's `get_merchant_insights` reporting tool when PayPal keys are
  configured, `source: 'hybrid'|'heuristic'|'paypal'` so the caller knows
  which).
- Frontend: `frontend/src/lib/backend.ts` has typed clients for all three
  (`getLedger`, `getLedgerSummary`, `askLedger`); `LedgerDashboard.tsx`
  shows a real "Live from your shop" KPI strip (revenue, margin kept, deals
  won, avg. fairness) above the existing local-estimate dashboard;
  `LedgerAsk.tsx`'s "Ask your ledger" calls the real agent and shows a
  source badge, falling back to its old local keyword-matcher only when
  there's no token/shop yet.

**What's actually still missing is narrower than before: the AG Grid/AG
Studio library itself was never installed, and its themed grid/widget
screen was never built** — `frontend/src/components/vendor/LedgerDashboard.tsx`
is still the pre-existing local-computation dashboard (`lib/ledger.ts`'s
`computeLedger()`) with a real-data strip added on top, not an AG Grid
Studio embed. `GET /v1/ledger`'s `widgets` object (margin-by-item bars, a
fairness histogram, the deal funnel) is returned by the backend today and
sitting unused on the frontend — exactly the shape AG Studio's widgets
would bind to. For whoever picks up the actual AG Grid UI work:

**1. What it needs from PayPal (backend, already available):** `list_transactions`,
`get_merchant_insights`, `list_disputes` — the first two are wired
(`backend/packages/paypal/src/reporting.ts`, used by `/v1/ledger/ask`'s
`externalFacts` hook when PayPal keys are set); `list_disputes` is not yet
called anywhere, lowest priority of the three.

**2. What's left to build (frontend only now):**
- Install `ag-grid-*` + AG Studio per the official boilerplate:
  **`paypaldev/hackathon-paypal-ag-grid-boilerplate`** (GitHub) — `plan.md`
  explicitly says to review this boilerplate before starting (§12.6
  "Immediate next actions": *"Review `paypaldev/hackathon-paypal-ag-grid-boilerplate`
  now. Delay starting the AG trial until about Oct 20"* — the 45-day trial
  license timing matters for whether it's still live at judging).
- A themed Merchant Ledger screen bound to `GET /v1/ledger`'s existing
  `rows`/`widgets`/`kpis` (no new backend work needed for this part) —
  replacing or sitting alongside today's `/app/seller/ledger` page, themed
  to match the app's existing design tokens (`plan.md:276`: *"Custom theme
  and widgets to match the design system (the sponsor prize judges polish)"*).
- Point `LedgerAsk.tsx`'s rendering at AG Studio's Studio Agent Framework
  instead of the current plain-text answer card, if claiming the full
  sponsor integration (not required for the data/logic to be real — that
  part already works).

**3. Why the UI piece wasn't built yet:** every other backend pass and frontend
wiring pass this project has gone through was prioritized around the
product's structural correctness first (real auth → real shop/inventory →
real basket/negotiation/payment/orders — all now done and verified, see
"What's wired now" above). AG Grid Studio is additive polish + a specific
sponsor prize, not something the core buyer/seller flow depends on, so it
was correctly deferred — but it is a real, counted gap against the plan's
own stated commitments (✅ Core, not optional) and its own prize category,
and it's the one piece of "sponsor integration" work that's actually
concrete and actionable, as opposed to the other sponsors above (Render:
infra decision; APIMatic: dev-tooling, not app code; Elastic/Zapier:
explicitly optional stretch; Bryntum/KERNEL/Astropods: explicitly skipped
in the plan itself).

**Reference links from `plan.md`:**
- AG Grid boilerplate: `https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate`
- PayPal Agent Toolkit (npm `@paypal/agent-toolkit`, MCP via `@paypal/mcp`) README on GitHub for the exact `reporting` tool definitions (`list_transactions`, `get_merchant_insights`).
- `plan.md` itself, sections: §0 TL;DR, §4 "Sponsor tools and how we use them", §7.2 item 6, §8.5 screen 7, §9.2.2 (`GET /v1/ledger/*` in the original API contract table), §9.4 Table (`list_transactions`, `get_merchant_insights`, `list_disputes` → "Feeds AG Studio and the Ledger Agent"), §12 (week-by-week plan: AG Grid trial work was scheduled for **Week 3, Oct 20–26**, and the final checklist's launch-readiness list literally includes *"AG Studio Merchant Ledger with custom widgets and the Ledger Agent"* as a submission-readiness item).

Everything else searched for (Auth0, Clerk, Supabase, Twilio, ElevenLabs,
Vapi, extra Anthropic/Claude usage beyond `packages/llm`, Vercel, Sentry,
Datadog, WorkOS, Stytch, Algolia, Pinecone, Weaviate) still turns up nothing
in either codebase — confirmed not relevant to this hackathon's actual
sponsor list per `plan.md`.

### Explicitly NOT backend gaps (frontend-only, said here so they aren't mistaken for missing backend work)

- [ ] Voice narration (Cartesia-generated clips, `frontend/src/lib/voiceClips.ts`, `frontend/scripts/gen-voice.ts`) is entirely client-side, build-time generated audio. No backend involvement needed or expected.
- [ ] Discovery / map (Leaflet + browser `navigator.geolocation`, `frontend/src/components/discovery/LeafletMap.tsx`, `ShopDiscovery.tsx`) runs entirely client-side against seeded shop coordinates and the browser's real GPS. The backend's eventual `GET /v1/shops/nearby?lat&lng&radius` (handoff §4) would replace the seeded coordinate list, but the map rendering and geolocation itself stay frontend-only.
- [ ] Gamification UI — XP/badges/streaks/predictions, per `frontend/docs/BE_HANDOFF.md` §3, is explicitly called out there as *"not modelled yet"* and *"cosmetic and must never change prices."* Still true; no backend schema exists for it and none should block a demo.

<<<<<<< HEAD
## Inline responses to pending backend items (2026-10-25)

### Backend — pending (status update)
- [x] **"Modern" inventory model** — **DONE:** Schema extended via `0010_modern_inventory` (`shop_items` gains `cost_cents`, `category`, `low_stock_at`, `archived`, `custom_unit`, `pack_size`; `stock_adjustments` audit table). Contracts updated (`costCents` stripped from `PublicShopItemSchema`, `floorCents` relaxed to nonnegative, `UpdateShopItemRequestSchema.archived` added). Repo/views wired. Soft-delete via `DELETE /v1/shops/me/items/:id` sets `archived: true`. `POST /v1/shops/me/items/:itemId/adjust` added with idempotency (`opId`).
- [x] **`locationUpdatedAt` on `shopView`** — **DONE:** Added to `ShopSchema` and included in `shopView`.
- [x] **Product-name search endpoint** — **DONE:** Added `POST /v1/search/products` for FE compatibility.
- [x] **Channel3 fix** — **DONE:** Rewrote to `https://api.trychannel3.com/v1/search` with `x-api-key`, USD→INR conversion via `fxUsdPerInr`, added tests. Deployed and verified live.
- [x] **Standalone negotiation convergence** — **DONE (Option A):** Engine clamps floor to 0.9× buyer ceiling.
- [ ] **Bulk endpoint** `POST /v1/shops/me/items/bulk` — **Not implemented** (perf-only).
- [ ] **Photo/image storage for `shop_items`** — **Not needed.** `POST /v1/inventory/snap` uses inline data URLs; no storage required. Demo works without.
<<<<<<< HEAD
- [x] **Ops keys** — SerpAPI/LLM unset on live instance (fallbacks). SMTP/Brevo configured for OTP emails.
=======
**Update, 2026-10-25:** Inventory model extended (migration `0010_modern_inventory`), soft-delete/archive support, stock adjustments with audit trail, `locationUpdatedAt` on shops, `POST /v1/shops/me/items/:id/adjust` endpoint added. Channel3 API fixed to use `api.trychannel3.com` with correct auth. `POST /v1/search/products` added for FE compatibility. Standalone negotiation now always converges (Option A) — engine clamps floor for standalone demo. Demo works without photo storage (snap uses inline data URLs).
=======
- [ ] **Ops keys** — SerpAPI/LLM/SMTP unset on live instance (fallbacks in place).
=======
### PayPal webhook + return flow (handoff to frontend)
- **Webhook configured**: `PAYPAL_WEBHOOK_ID=8FA144871W048541L` set on live API; webhooks from PayPal should verify and auto-capture via `approveAndCapture()`. Sandbox events may still require correct event subscription.
- **Return URL points to API**: `PUBLIC_BASE_URL` points to `https://api.52.64.250.111.nip.io`, so PayPal redirects to API (`/return?token=...&PayerID=...`) which has no handler (404). Either change `PUBLIC_BASE_URL` to frontend URL or add API redirects.
- **UI doesn't auto-refresh on webhook capture**: `PayFlow` waits for user to click "I've approved it on PayPal" and calls `captureBasket()`. Webhook captures server-side but UI won't transition automatically. `captureBasket()` is idempotent if already captured (returns proofs), so clicking the button again works as fallback.
- **Needed frontend changes**:
  - Add `/app/return` and/or `/app/cancel` pages to handle PayPal redirect, read `token`/`PayerID`, auto-call `captureBasket()` and redirect to receipt
  - Or poll `getBasket()`/`getOrder()` while in "paying" state to detect webhook-captured payments
  - Or extend basket SSE to emit payment status events so UI updates in real-time
  - Consider changing `PUBLIC_BASE_URL` to frontend origin for better UX
>>>>>>> 28bb195 (docs: add PayPal webhook/return flow handoff for frontend)
>>>>>>> b76861a (docs: add PayPal webhook/return flow handoff for frontend)
