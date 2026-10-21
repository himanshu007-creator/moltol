# BE handoff

Source of truth: zod schemas and the typed TS interfaces named below. Money is integer paise (`₹`),
formatted with Intl (`src/lib/money.ts`). Quantities always carry a unit (`src/lib/units.ts`).

> **Status update (backend now real).** The API was built from PR **#5**
> (`feat/backend-frontend-inr-fx-snap-feed`); its instance has since been retired and no API
> is deployed right now (rebuild with `terraform apply` under `AWS_PROFILE=moltol`).
> §1's mock layer and §4's table now point at real
> routes; where the doc and the API disagree, the API (§4) wins. The FE still runs its mock by
> default (`PUBLIC_USE_FIXTURE=true`), so this file now reads as "mock today, real endpoint
> beside it". The API is **basket-first**: the per-line primitive is `POST /v1/baskets`
> (one negotiation per basket line under one basket id), not `POST /v1/negotiations` — the
> latter survives only as the original single-query demo.
>
> Also new since the doc was written: seller deal stream (`/v1/shops/me/deals/*`), live
> location (`PATCH /v1/shops/me/location` + `locationUpdatedAt` on nearby), photo snap
> (`POST /v1/inventory/snap`), payment retry (`POST /v1/baskets/:id/retry`), ledger agent
> (`POST /v1/ledger/ask`), and **INR→USD checkout** (§6). See `backend/docs/adr/` 0007–0008
> for the two design decisions.

## 1. Overview and mock layer

| Concern | Mock today | File | Real (now in the API) |
| --- | --- | --- | --- |
| Local data (stock, venue, orders, ledger, buyer prefs) | Zustand `persist` to IndexedDB (`moltol`/`kv`) | `src/lib/idb.ts` | REST; stores become caches (`§9` checklist) |
| Negotiation stream | Scripted lanes (`buildCartScript`) | `src/lib/mock/seeds.ts`, `src/stores/bazaar.ts` | SSE `GET /v1/baskets/:id/events` (one frame carries every line, routed by `lineItemId`) |
| Shop status fan-out | BroadcastChannel `moltol-venue` | `src/stores/venue.ts` | SSE `GET /v1/shops/status/stream` |
| Seller deal feed | none | — | SSE `GET /v1/shops/me/deals/stream?ticket=` (`deal.incoming` / `deal.closed`) |
| Auth + OTP | Fixed OTP `1234` | `src/lib/mock/auth.ts` | Real: `POST /v1/auth/signup` → `/v1/auth/otp/verify` (email OTP; token → JWT) |
| Market comps | Static `COMP_LIB` + seeded samples | `src/lib/mock/market.ts` | `GET /v1/market/comps` (Channel3 → SerpAPI → seeded) |
| Discovery | GPS or walking distances | `src/lib/mock/discovery.ts` | `GET /v1/shops/nearby?lat&lng&radiusM` (ships `locationUpdatedAt`) |
| Vision (snap) | Canned suggestions | `src/lib/inventory.ts` (`SNAP_SUGGESTIONS`) | `POST /v1/inventory/snap` — image sent inline as a data URL; vision model when `LLM_*` set, else a built-in catalogue |
| Payment | Mock PayPal-style sheet | `src/components/buyer/PayFlow.tsx` | Real: `POST /v1/baskets/:id/checkout` → approve → `/capture`, `/retry` for a denied order |

**One flag to swap:** `PUBLIC_USE_FIXTURE` (`src/lib/ws.ts`, `useFixture()`). Set it to `false` and the
transport becomes `openSocket(PUBLIC_WS_BASE + …)`. Every store keeps its shape.

## 2. Auth and roles

| Item | Shape | File |
| --- | --- | --- |
| Session | `{ loggedIn, name, phone, avatarEmoji, activeRole: 'buyer'\|'seller', buyerProfileDone, sellerProfileDone, lastRoute, pendingNote }` | `src/stores/session.ts` |
| Dual-role model | One account, both profiles. Role is a view switch, not a login. | `Shell.tsx` `doSwitch` |
| Switch semantics | Flips `activeRole` in the store, then client-navigates to the role's last route (no reload). Seller without a profile goes to `/simple/setup`. | `src/components/Shell.tsx` |
| Route guard | `requireAuth`: logged out → `/login` | `src/stores/session.ts` |
| Seller-only data | `minCents` (lowest price), `costCents` | `src/lib/inventory.ts` |
| Buyer-only data | Personality preset (saved default and per-basket override) | `src/stores/buyer.ts` |

Rule: the buyer view never renders `minCents` or a buyer max before the proof reveal. Views derive from
`activeRole`. Server must enforce the same: a buyer token never receives seller floors.

## 3. Entities

### User / session
Session above. The BE returns `{ userId, roles: ['buyer','seller'], activeRole }`. The role switch
should not need a new token.

### ShopProfile
`Shop` in `src/lib/mock/seeds.ts`:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | `thela-01`, `kirana-01`, `fruit-01`, `demo-01` (the demo seller) |
| `name` | `{en, hi, pa}` | |
| `kind` | `'thela'\|'kirana'\|'fruit'` | |
| `emoji` | string | |
| `x`, `y` | number 0..100 | stylized map |
| `lat`, `lng` | number | real map |
| `distanceM` | number | mock walking distance |
| `persona` | `'charmer'\|'stoic'\|'storyteller'` | seller haggle style |
| `products` | `InventoryItem[]` (buyer view) | demo-01 comes from the inventory store |
| `bundle?` | `{ skus: [string, string], discountCents }` | |

Live status (`StallStatus` in `src/stores/venue.ts`): `{ open: boolean, closeAt?: epochMs|null, reopenAt?: epochMs|null }`.

### InventoryItem (seller side)
`StockItemSchema` in `src/lib/inventory.ts` (zod, source of truth):

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | |
| `name` | string 1..60 | |
| `category` | string 1..30 | default `general` |
| `emoji` | string | |
| `unit` | enum `kg,g,litre,ml,piece,dozen,bunch,pack,custom` | `src/lib/units.ts` |
| `customUnit?` | string ≤ 20 | required when `unit = custom` |
| `packSize?` | number > 0 | g or ml, for `pack`/`custom` |
| `qty` | number ≥ 0 | in `unit`, rounded to 3 dp for mass/volume, integer for counts |
| `costCents` | int ≥ 0 | |
| `minCents` | int ≥ 0 | **seller only**, must be ≥ `costCents` |
| `listCents` | int > 0 | must be ≥ `minCents` |
| `lowStockAt` | number ≥ 0 | default 5 |
| `compKey?` | string | comps library key |
| `archived` | boolean | archived items never reach buyers |
| `updatedAt` | epoch ms | |

Buyer projection: `toBuyerItems()` drops archived and out-of-stock items. It maps to the buyer
`InventoryItem` (`sku, itemId, title, emoji, unit, listCents, floorCents, stock, market?`).
**Note:** the buyer projection still carries `floorCents` for the negotiation engine. The BE must
keep it server-side (see §8).

### Cart / LineItem
`CartLine` in `src/stores/cart.ts`: `{ sku, shopId, title, emoji, unit, listCents, qty, stock }`.
`qty` is fractional for weight and volume (step from `UNITS[unit].step`, e.g. 0.25 kg), integer for counts.
Totals: `Math.round(Σ listCents × qty)`.

### NegotiationRequest (personality)
`src/lib/personality.ts`:

```ts
{ preset: 'quick'|'balanced'|'hard', rounds: number /* 3|5|8 */, tone: 'polite'|'playful'|'firm', bundle: boolean }
```
Presets: `quick` (3 rounds, polite, bundles on, ~10 s, ~3% saved), `balanced` (5, playful, bundles on, ~25 s, ~7%),
`hard` (8, firm, bundles off, ~40 s, ~11%). The time and savings values are **mock estimates** and must be labelled.
Sent as `request` in `bazaar.start`. The per-basket choice overrides the saved default in `src/stores/buyer.ts`.

### NegotiationEvent (union)
`NegotiationEventSchema` in `src/lib/events.ts` (zod discriminated union on `t`):

| `t` | Payload |
| --- | --- |
| `session.started` | `negotiationId, roundsMax, market: {medianCents, p25Cents, p75Cents}` (+ currency) |
| `commit.recorded` | `side: buyer\|shop, commit: hex` |
| `turn` | `seq, actor, kind: offer\|counter\|accept\|walkaway, priceCents?, message, tactic?` |
| `deal.agreed` | `priceCents` |
| `payment.status` | `status: order_created\|approved\|captured\|failed` |
| `proof.revealed` | `verified, fairness, buyerSaved, reveal: {buyerLimit, buyerSalt, shopLimit, shopSalt}` |
| `session.ended` | `reason: deal\|no_zopa\|timeout\|human_cancel` |

**Gap for the BE:** the union is one negotiation per stream. The FE runs one lane per item
(`Lane.sku`, `Lane.itemId`). Add **`lineItemId`** to every event (`turn`, `deal.agreed`, `session.ended`)
and one `session` per line item under a cart-level `negotiationId`.

### Deal
`Deal` in `src/lib/ledger.ts`:
`{ id, ts, sku, buyer (first name only), won, qty, pricePerUnitCents }`. Lost deals keep the same shape with `won: false`.

### Order
`Order` in `src/stores/orders.ts`:
`{ id, ts, shopId, shopName, shopEmoji, lines: OrderLine[], totalCents, marketCents, savingsCents, fairness, proofVerified, trackerIndex, etaMin, paymentStatus }`.
`OrderLine`: `{ sku, title, emoji, unit, qty, unitCents, noDeal? }`.

### Payment
`PaymentStatus` = `order_created | approved | captured | failed`. Only `payment.status` events and
`Order.paymentStatus` carry it. No amounts travel with a status change (the order has them).

### Insight cards
Buyer, `src/components/buyer/Insights.tsx`. Each card is `{headline, reason, action}`.

| Card | Source today | Should move to BE |
| --- | --- | --- |
| Saved, all baskets | Σ `Order.savingsCents` | yes |
| Baskets haggled | `Order` count | yes |
| Average saved vs sticker | Σ saved / (Σ spend + Σ saved) | yes |
| Day streak | `Order.ts` dates | yes |
| Monthly budget | `BUYER_HISTORY` (mock) | yes, goal per user |
| Spend and saved, 6 months | `BUYER_HISTORY` (mock) | yes |
| Nudge (cheaper nearby) | `samples()` comps | yes (market service) |

### Ledger aggregates
`Ledger` in `src/lib/ledger.ts` (pure function `computeLedger(items, deals, now)`):
`kpis` (revenue, profit, margin, list-kept %, won, lost, win rate), `rows` (per item), rankings
(`mostSold, leastSold, highestProfit, lowestMargin`), `deadStock`, `lowStock`, `byDay|byWeek|byMonth`
buckets, `peakHours`, `repeatCustomers` (first name), `hints` (`restock`, `min_up`, `min_down`).
Each hint has a `reason` and an `action`.

### Gamification (partial)
XP, badges, streaks, predictions and tension are **not modelled yet**. Components exist
(`HaggleTheatre`, `ReceiptView`, `ShopDiscovery`) but have no store or schema. Model them as
`{ xp: number, badges: string[], streak: {current, best}, predictions: [{negotiationId, guess, outcome}] }`.
They are cosmetic and must never change prices.

## 4. Endpoints

**Real routes now in the API** (verified against `/docs/json` on the live instance). Auth = `Bearer` JWT on
`Authorization`. Deviations from the mock shape this doc describes are marked **⚠ differs**.

| Method | Path | Request | Response | Auth | FE caller today |
| --- | --- | --- | --- | --- | --- |
| POST | `/v1/auth/signup` | `{email, password}` **⚠ differs (FE mocks phone)** | `{normalizedEmail, message, resendCooldownSeconds}` | any | `signup` |
| POST | `/v1/auth/otp/verify` | `{email, code}` (6-digit, email-delivered) | `{token, user}` | any | `verifyOtp` |
| POST | `/v1/auth/otp/resend` | `{email}` | cooldown | any | — |
| POST | `/v1/auth/login` | `{email, password}` | `{token, user}` | any | — |
| POST | `/v1/auth/logout` | — | revokes the session (per-`jti`) | any | — |
| POST | `/v1/auth/password/forgot` · `/reset` | `{email}` · `{email, code, newPassword}` | — | any | — |
| GET | `/v1/me` | — | `{id, email, hasShop, activeRole, hagglePreset, shop?}` | any | session store |
| PATCH | `/v1/me/role` | `{activeRole}` | `{activeRole}` | any | `switchRole` |
| PUT | `/v1/me/preferences/haggle` | `{preset}` | `{preset}` | buyer | `useBuyer.setPersonality` |
| POST | `/v1/shops/me` | `{name, emoji, persona?, location?}` | `Shop` | seller | `setup` |
| GET · PATCH | `/v1/shops/me` | partial `Shop` | `Shop` | seller | `ShopProfile` |
| PATCH | `/v1/shops/me/location` | `{lat, lng}` | `Shop` | seller | (new — live pin) |
| PUT | `/v1/shops/me/status` | `{open, closeInMin?, reopenAt?}` | `{status}` | seller | `useVenue.toggle/closeIn/reopenIn` |
| POST · PATCH · DELETE | `/v1/shops/me/items` | `CreateShopItem` / `UpdateShopItem` | `ShopItem` (**owner view: carries `floorCents`**) | seller | `add`/`update`/archive |
| GET | `/v1/shops/nearby` | `?lat&lng&radiusM` | `NearbyShop[]` (open by distance, closed last, `locationUpdatedAt`) | buyer | `ShopDiscovery`, `NearbyMap` |
| GET | `/v1/shops/:shopId` | — | `{shop, items: PublicShopItem[] (no floors)}` | buyer | `liveShops`, `StallGrid` |
| POST | `/v1/baskets` | `{shopId, lines:[{itemId, qty}], request}` | `Basket` (one negotiation per line) | buyer | `bazaar.start` |
| GET | `/v1/baskets/:id` | — | `Basket` (`totals`, `paypalOrderId`) | buyer | — |
| POST | `/v1/baskets/:id/lines/:lineId/takeover` · `/offer` · `/accept` | `{priceCents}?` | `{line, accepted, counterCents}` | buyer | `takeOver`/`offerLine`/`acceptLine` |
| POST | `/v1/baskets/:id/accept-all` | — | `{agreed[], basket}` | buyer | `acceptAll` |
| POST | `/v1/baskets/:id/checkout` | — | `{paypalOrderId, approveUrl, amountCents, currency, deal{amountCents,currency}, fxRate}` **⚠ amounts are converted** | buyer | `PayFlow` (§6) |
| POST | `/v1/baskets/:id/capture` | — | `{status, captureId, proofs[]}` | buyer | `finishCapture` |
| POST | `/v1/baskets/:id/retry` | — | same as checkout (fresh order after a denial) **⚠ new** | buyer | (new) |
| GET | `/v1/baskets/:id/proof` | — | `{basketId, proofs[]}` (once `paid`) | buyer | `ReceiptView` |
| GET | `/v1/orders` · `/v1/orders/:id` | — | `Order[]` / `Order` | buyer | `useOrders`, `Orders.tsx` |
| GET | `/v1/ledger` · `/v1/ledger/summary` | `?period=7d\|30d\|90d\|all` | `Ledger` / `LedgerSummary` **⚠ new** | seller | `computeLedger` |
| POST | `/v1/ledger/ask` | `{question}` | `LedgerAnswer` (LLM, heuristic fallback) **⚠ new** | seller | `LedgerAsk.respond` |
| GET | `/v1/insights/buyer` | — | `BuyerInsights` **⚠ new** | buyer | `Insights.tsx` |
| GET | `/v1/shops/me/deals` | `?since` | `ShopDeal[]` | seller | `useLedger` |
| POST | `/v1/shops/me/deals/ticket` | — | `{ticket, expiresInSec: 120}` **⚠ new** | seller | (new) |
| GET | `/v1/shops/me/deals/stream` | `?ticket` (no header — SSE) | `DealFeedEvent` (`deal.incoming` \| `deal.closed`) **⚠ new** | ticket | (new) |
| POST | `/v1/inventory/snap` | `{image: dataURL, hint?}` | `{source: vision\|catalogue, suggestions[]}` **⚠ inline data URL, not multipart** | any | `SNAP_SUGGESTIONS` |
| GET | `/v1/market/comps` | `?query&currency` | `MarketRange` **⚠ new** | — | `COMP_LIB` |
| POST | `/v1/negotiations` · `/checkout` · `/capture` | single-query demo | legacy, not basket-backed | — | — |

**Not in the API (FE-only, do not wait on):** inventory CSV bulk import, `voice-parse`, bulk `list_pct`/
`archive`, and `GET /v1/inventory` — the real seller inventory lives at `/v1/shops/me/items`.

Errors are RFC 9457 `problem+json` (`type`/`title`/`detail`), **not** `{error:{code,message}}` —
e.g. `409 insufficient_stock`, `409 checkout_started`, `409 still_negotiating`.

## 5. Realtime

All live channels are **SSE**, not WS (`EventSource` cannot send an `Authorization` header, so streams
are keyed by an unguessable id or by a 120 s ticket — see ADR 0007). Every frame's `id:` is the dot-joined
last seq of every lane; a reconnect sends it back as `Last-Event-ID`, so nothing is replayed.

| Channel | Direction | Event | Payload | Consumers |
| --- | --- | --- | --- | --- |
| SSE `GET /v1/baskets/:id/events` | server → client | `NegotiationEvent` (§3), routed by `negotiationId` (= `lineItemId`) | per line, public (`audience:"all"`) only | buyer, seller |
| SSE `GET /v1/shops/status/stream` | server → client | `shop.status` `{shopId, open, closeAt, reopenAt}` | shared channel, no auth | buyer map, stall pages |
| SSE `GET /v1/shops/me/deals/stream?ticket=` | server → client | `deal.incoming` `{shopId, basketId, ts, currency, totalCents, lines[]}` / `deal.closed` `{basketId, negotiationId, priceCents, …}` | seller only (mint the ticket first: `POST /v1/shops/me/deals/ticket`) | seller live feed |
| SSE `GET /v1/negotiations/:id/events` | server → client | same union (legacy single-query demo) | — | — |

FE demo today: `BroadcastChannel('moltol-venue')` carries the full stall map (`src/stores/venue.ts`).
The payload is the same shape as `shop.status` applied to every shop, so replacing the channel with SSE
changes only the transport.

## 6. PayPal flow

Real and verified end to end in sandbox (order → approve → capture, webhook self-verified).

| Step | Who | Call | FE hook to replace |
| --- | --- | --- | --- |
| 1 | BE | `POST /v1/baskets/:id/checkout` → Orders v2 create (intent CAPTURE, `custom_id = basketId`, stable `PayPal-Request-Id`) → `{paypalOrderId, approveUrl, amountCents, currency, deal, fxRate}` | `PayFlow` create step |
| 2 | FE | open `approveUrl` (or the JS SDK v6 sheet) and wait | `PayFlow` sheet |
| 3 | BE | `POST /v1/baskets/:id/capture` after approval (idempotent) | `PayFlow` capture step |
| 4 | BE | Webhooks `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED` / `.DENIED`, signature-verified, deduped on `event.id` | SSE `payment.status` |
| 5 | FE | Render `payment.status`, update `Order.paymentStatus`; on denial `POST /v1/baskets/:id/retry` issues a fresh order for the same agreed lines | `useOrders` |

**INR → USD settlement (ADR 0008).** Shops price in `INR`; PayPal cannot charge INR, so the order is
created in `PAYPAL_SETTLEMENT_CURRENCY` (default `USD`) at `FX_USD_PER_INR`. The response's
`amountCents`/`currency` is the **charge**; `deal` is the haggled INR total and `fxRate` is the rate used.
Show "₹4,000 ≈ $48.00" from `deal` + `fxRate` — never treat `amountCents` as the deal total. The whole
app stays in INR (line, proof, ledger); only the payment is converted.

**Swap point:** `PayFlow.tsx` should call a `PaymentGateway` interface with `createOrder`, `approve`,
`capture`, `subscribe(status)`. The mock implements it locally, the PayPal one uses the SDK. The interface
is **not yet extracted** (open item).

## 7. Server-computed analytics

What the FE computes today versus where it should run.

| Metric | Formula | FE today | BE |
| --- | --- | --- | --- |
| Revenue | Σ `pricePerUnit × qty` over won deals | `computeLedger` | yes |
| Profit | Σ `(pricePerUnit − costCents) × qty` | `computeLedger` | yes |
| Margin | `profit / revenue × 100` | `computeLedger` | yes |
| List kept | `revenue / (Σ listCents × units) × 100` | `computeLedger` | yes |
| Win rate | `won / (won + lost) × 100` | `computeLedger` | yes |
| Sell-through | `units sold in window / (units sold + stock)` | not yet | yes |
| Dead stock | `stock > 0` and no sale in `DEAD_STOCK_DAYS` (14) | `computeLedger` | yes |
| Low stock | `stock ≤ lowStockAt` | `computeLedger` | yes |
| Restock hint | `perDay = units14 / 14`; hint if `stock / perDay < 3` days | `computeLedger` | yes |
| Min-price hint | win ≥ 85% and list kept < 100 → raise min 3%; win < 50% → lower min 3% (never below cost) | `computeLedger` | yes |
| Savings (buyer) | `Σ (marketCents − totalCents)` per order | `Insights.tsx` | yes |
| Average saved | `Σ saved / (Σ spend + Σ saved)` | `Insights.tsx` | yes |
| Month over month | `(this − last) / last × 100` | `Insights.tsx` | yes |

## 8. Security

| Rule | Where it is enforced today | BE requirement |
| --- | --- | --- |
| Floors (`minCents`) and buyer max never sent to a buyer before reveal | Buyer views do not render them (grep-verified). The buyer projection still carries `floorCents` for the engine. | Strip from every buyer response and WS event. Only `proof.revealed` carries reveal salts. |
| Commit/reveal | `commit.recorded` (hex). `proof.revealed` has `reveal {buyerLimit, buyerSalt, shopLimit, shopSalt}`. | Verify `H(limit‖salt)` server-side before emitting reveal. |
| Min ≥ cost, list ≥ min | Client `checkPrices` in `src/lib/inventory.ts` | Same rule in the API (400). Client check is UX only. |
| Unit rules | `clampQty` (mass/volume 3 dp, counts integer), unit enum | Reject unknown units. Reject fractional counts. |
| Rate limits | None | Real: global `RATE_LIMIT_PER_MIN` per client IP (stricter on auth), per-user on baskets, and `/v1/inventory/snap` is authenticated + size-capped (5 MB body) since it may call a vision model |
| Idempotency | None | `PayPal-Request-Id` on checkout. Dedupe webhooks on `event.id`. |
| Buyer names | First name only in deals and ledger | Keep the rule in the API |

## 9. What is mocked vs real, env, open questions

| Area | FE status | Backend status |
| --- | --- | --- |
| Auth (email + password + emailed OTP, JWT) | Mock OTP `1234`, phone-based **⚠ shape differs** | **Real** (`/v1/auth/*`), email OTP via Brevo when configured |
| Shop create/update, status, open/close timers | FE complete (local) | **Real** (`/v1/shops/me/*`) |
| Inventory CRUD | FE complete (IndexedDB) | **Real** as `/v1/shops/me/items` (owner view carries `floorCents`; buyer view strips it) |
| Inventory CSV bulk, voice parse, `list_pct`/archive bulk | FE only | **Not in the API** (client-side; do not wait) |
| Snap to add | Canned suggestions | **Real** — `POST /v1/inventory/snap`, inline data URL, vision model or built-in catalogue |
| Nearby, comps | Mock | **Real** — `/v1/shops/nearby` (fresh `locationUpdatedAt`), `/v1/market/comps` |
| Negotiation (basket) | Scripted lanes | **Real** — `/v1/baskets` + per-line SSE |
| Checkout, capture, retry | Mock sheet | **Real** — sandbox-verified; **INR→USD** at checkout (§6) |
| Ledger, insights, ask-the-ledger | Derived from seeded history | **Real** — `/v1/ledger`, `/summary`, `/ask`, `/v1/insights/buyer` |
| Seller live deal feed | none | **Real** — ticket + SSE stream |
| Gamification | Partial, not modelled | none (correct: cosmetic) |
| AG Grid ledger | Not built. The FE uses a plain table. | endpoints ready |
| MapLibre | Not built. The FE uses Leaflet. | — |

**Env vars** (`.env.example`): `PUBLIC_USE_FIXTURE` (true for mock), `PUBLIC_API_BASE`, `PUBLIC_WS_BASE`,
`PUBLIC_PAYPAL_CLIENT_ID` (sandbox, client-side only, never a secret).

**Swap checklist**
1. Set `PUBLIC_USE_FIXTURE=false`, `PUBLIC_API_BASE` to your deployed API base (terraform
   prints it on apply; keep the `/v1/version` sanity check).
2. Replace `idbStorage` reads with fetches. Keep the zustand shapes. Stores become caches.
3. Route the endpoints in §4 through one client module (not built yet).
4. Replace `BroadcastChannel` with `GET /v1/shops/status/stream` (SSE, §5).
5. Point `PayFlow` at `POST /v1/baskets/:id/{checkout,capture,retry}` and render `deal` + `fxRate`
   rather than treating `amountCents` as the haggled total (§6).
6. Strip buyer-side `floorCents` (§8) — the API already does; the FE must stop rendering it.
7. **Reconcile auth shape first:** the API signs up with `{email, password}` and verifies an emailed
   6-digit code, while the FE mock uses `{phone, otp: '1234'}`. This is the one blocking mismatch.

**Answers to the open questions (settled by the backend)**

1. *`lineItemId` per cart line, or one negotiation per item?* — **Per basket line.** `POST /v1/baskets`
   creates one `negotiations` row per line under one basket id; a line's id *is* its `lineItemId`, so the
   event union and every route key off it unchanged (ADR 0006). The basket id is the stream capability.
2. *Who owns `shop.status` fan-out?* — **The API** (`container.publish` → Redis `shop.status` channel),
   independent of the worker.
3. *Vision: SerpAPI Lens or a vision model?* — **Neither SerpAPI nor a hosted image store.** The image goes
   inline as a data URL; an OpenAI-compatible vision model names the products when `LLM_*` is set, else a
   built-in Indian-grocery catalogue matched on `hint`. SerpAPI *is* used for market comps (Q4).
4. *Comps: Channel3 or SerpAPI?* — **Both, in order** (`Channel3 → SerpAPI → seeded`), configured by
   `CHANNEL3_API_KEY` / `SERPAPI_API_KEY`. Currently unset on the live instance → seeded.
5. *Does `rounds` shorten the stream or the LLM budget?* — **The LLM turn budget**; pacing is the worker's
   `TURN_DELAY_MS`, and a human takeover supersedes any queued agent step.
6. *Is `minCents` sent to the BE in plaintext or sealed?* — **Both, deliberately:** the shop's own
   `floorCents` is stored and returned only to its owner (stripped for buyers), while the *negotiation*
   limit is a per-line reserve drawn at basket creation and sealed with commit–reveal — the proof reveals
   that reserve, never the standing floor (ADR 0006).
