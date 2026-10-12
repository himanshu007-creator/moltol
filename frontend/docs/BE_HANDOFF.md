# BE handoff

Source of truth: zod schemas and the typed TS interfaces named below. Everything here is what the FE
calls today through mock adapters. Money is integer paise (`₹`), formatted with Intl (`src/lib/money.ts`).
Quantities always carry a unit (`src/lib/units.ts`). Status: **mock**, the FE runs fully offline.

## 1. Overview and mock layer

| Concern | Mock today | File | Real later |
| --- | --- | --- | --- |
| Local data (stock, venue, orders, ledger, buyer prefs) | Zustand `persist` to IndexedDB (`moltol`/`kv`) | `src/lib/idb.ts` | REST/WS, the store becomes a cache |
| Negotiation stream | Scripted lanes (`buildCartScript`) | `src/lib/mock/seeds.ts`, `src/stores/bazaar.ts` | WS `negotiation` channel (§5) |
| Shop status fan-out | BroadcastChannel `moltol-venue` | `src/stores/venue.ts` | WS `shop.status` (§5) |
| Auth + OTP | Fixed OTP `1234` | `src/lib/mock/auth.ts` | Real auth |
| Market comps | Static `COMP_LIB` + seeded samples | `src/lib/mock/market.ts` | Channel3 / SerpAPI comps |
| Discovery | GPS or walking distances | `src/lib/mock/discovery.ts` | Geo query |
| Vision (snap) | Canned suggestions | `src/lib/inventory.ts` (`SNAP_SUGGESTIONS`) | Vision model, SerpAPI Lens is an option |
| Payment | Mock PayPal-style sheet | `src/components/buyer/PayFlow.tsx` | PayPal JS SDK v6 (§6) |

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

Replace each mock call with the endpoint shown. Auth = `buyer` or `seller` role on the session.

| Method | Path | Request | Response | Auth | FE caller today |
| --- | --- | --- | --- | --- | --- |
| POST | `/v1/auth/otp` | `{phone}` | `{ok, sentTo}` | any | `requestOtp` |
| POST | `/v1/auth/verify` | `{phone, otp, role}` | `{session}` | any | `verifyOtp` |
| GET | `/v1/me` | — | `{userId, roles, activeRole, profiles}` | any | session store |
| PATCH | `/v1/me/role` | `{activeRole}` | `{activeRole}` | any | `switchRole` |
| GET | `/v1/shops/nearby` | `?lat&lng&radius` | `[{shopId, name, distanceM, open, persona}]` (closed listed last) | buyer | `ShopDiscovery`, `NearbyMap` |
| GET | `/v1/shops/:id` | — | `{shop, products: BuyerItem[], status}` (no floors) | buyer | `liveShops`, `StallGrid` |
| PUT | `/v1/shops/:id/status` | `{open, closeInMin?, reopenInMin?}` | `{status: StallStatus}` | seller (owner) | `useVenue.toggle/closeIn/reopenIn` |
| GET | `/v1/inventory` | `?includeArchived` | `StockItem[]` | seller | `useInventory` |
| POST | `/v1/inventory` | `StockItemSchema` minus `id, updatedAt` | `StockItem` | seller | `add` |
| PATCH | `/v1/inventory/:id` | partial `StockItem` | `StockItem` (400 on min < cost or list < min) | seller | `update` |
| POST | `/v1/inventory/:id/adjust` | `{delta, reason}` | `StockItem` | seller | `adjust` |
| POST | `/v1/inventory/bulk` | `{ids, op: 'list_pct'\|'archive'\|'restore', pct?}` | `{updated}` | seller | `bulkListPct`, `setArchived` |
| POST | `/v1/inventory/import` | CSV file or `StockDraft[]` | `{imported, errors: [{line, message}]}` | seller | `parseCsv` → `importMany` |
| POST | `/v1/inventory/voice-parse` | `{text, locale}` | `{name, qty, unit, listCents?}` | seller | `parseVoiceLine` |
| POST | `/v1/inventory/snap` | multipart image | `{suggestions: [{name, emoji, unit, listCents, compKey}]}` (SerpAPI or vision model) | seller | `SNAP_SUGGESTIONS` |
| POST | `/v1/negotiations` | `{shopId, lines: [{sku, qty}], scope, request: NegotiationRequest, budgetCents?}` | `{negotiationId, lines: [{lineItemId, sku}]}` | buyer | `bazaar.start` |
| GET | `/v1/negotiations/:id/stream` | — (WS or SSE, §5) | `NegotiationEvent` | buyer, seller | `buildCartScript`, `playEvents` |
| POST | `/v1/negotiations/:id/lines/:lineItemId/takeover` | — | `{controlled: true}` | buyer | `takeOver` |
| POST | `/v1/negotiations/:id/lines/:lineItemId/offer` | `{priceCents}` (guarded) | `{accepted, verdict}` | buyer | `humanOffer` |
| POST | `/v1/negotiations/:id/accept-all` | — | `{agreed: [{lineItemId, priceCents}]}` | buyer | `acceptAll` |
| POST | `/v1/negotiations/:id/lines/:lineItemId/accept` | — | `{priceCents}` | buyer | `acceptLane` |
| POST | `/v1/checkout` | `{negotiationId, paymentMethod}` | `{orderId, paypalOrderId, approveUrl}` | buyer | `PayFlow` |
| GET | `/v1/orders` | — | `Order[]` | buyer | `useOrders` |
| GET | `/v1/orders/:id` | — | `Order` (tracker, proof) | buyer | `Orders.tsx` |
| GET | `/v1/insights/buyer` | — | `{cards, monthly: HistoryMonth[], nudges}` | buyer | `Insights.tsx` |
| GET | `/v1/ledger` | `?period=day\|week\|month` | `Ledger` (§7) | seller | `computeLedger` |
| GET | `/v1/deals` | `?since` | `Deal[]` | seller | `useLedger` |
| PUT | `/v1/me/preferences/haggle` | `{preset}` | `{preset}` | buyer | `useBuyer.setPersonality` |

Errors: `{error: {code, message, field?}}`. Price errors use `code: min_below_cost` or `list_below_min`
and carry the friendly text the FE shows inline.

## 5. Realtime

| Channel | Direction | Event | Payload | Consumers |
| --- | --- | --- | --- | --- |
| WS `/v1/stream/:negotiationId` | server → client | `NegotiationEvent` (§3) | per `lineItemId` (to add) | buyer, seller |
| WS `/v1/shops/:id/status` (or a shared `shop` topic) | server → client | `shop.status` `{shopId, open, closeAt, reopenAt}` | fan-out to every map client | buyer map, stall pages |
| WS `/v1/seller/:shopId/deals` | server → client | `deal.incoming` `{negotiationId, sku, qty, offerCents, listCents, minCents}` | seller only, `minCents` allowed here | seller live feed |
| WS `/v1/seller/:shopId/deals` | server → client | `deal.closed` `{orderId, sku, priceCents}` | soundbox, coin-drop, haptic trigger | seller |

FE demo today: `BroadcastChannel('moltol-venue')` carries the full stall map (`src/stores/venue.ts`).
The payload is the same shape as `shop.status` applied to every shop, so replacing the channel with WS
changes only the transport.

## 6. PayPal flow

Expected by the FE: create order → approval → capture → webhook-driven status.

| Step | Who | Call | FE hook to replace |
| --- | --- | --- | --- |
| 1 | BE | `POST /v2/checkout/orders` (intent CAPTURE, `custom_id = negotiationId`, `PayPal-Request-Id` = negotiationId) | `PayFlow` create step |
| 2 | FE | JS SDK v6 approval for `paypalOrderId` (sandbox only) | `PayFlow` sheet (labelled "Sandbox demo" today) |
| 3 | BE | `POST /v2/checkout/orders/:id/capture` after approval | `PayFlow` capture step |
| 4 | BE | Webhooks `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, verified by signature, deduped on `event.id` | WS `payment.status` event |
| 5 | FE | Renders `payment.status`, updates `Order.paymentStatus` | `useOrders` |

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
| Rate limits | None | Per-IP on `/v1/auth/otp`, per-user on `/v1/negotiations` (LLM cost), per-user on `/v1/inventory/snap`. |
| Idempotency | None | `PayPal-Request-Id` on checkout. Dedupe webhooks on `event.id`. |
| Buyer names | First name only in deals and ledger | Keep the rule in the API |

## 9. What is mocked vs real, env, open questions

| Area | Status |
| --- | --- |
| Inventory CRUD, CSV, voice parse, validation | FE complete. Local (IndexedDB). |
| Snap to add | Canned. Needs a vision backend. SerpAPI is the sketched option. |
| Open/close, timers, live sync | FE complete. BroadcastChannel. |
| Nearby, comps | Mock. |
| Negotiation | Scripted lanes. |
| Checkout and PayPal | Mock sheet. No PayPal calls. |
| Ledger, insights | Derived from seeded history. |
| Gamification | Partial, not modelled. |
| AG Grid ledger | Not built. The FE uses a plain table. |
| MapLibre | Not built. The FE uses Leaflet. |

**Env vars** (`.env.example`): `PUBLIC_USE_FIXTURE` (true for mock), `PUBLIC_API_BASE`, `PUBLIC_WS_BASE`,
`PUBLIC_PAYPAL_CLIENT_ID` (sandbox, client-side only, never a secret).

**Swap checklist**
1. Set `PUBLIC_USE_FIXTURE=false`, `PUBLIC_API_BASE`, `PUBLIC_WS_BASE`.
2. Replace `idbStorage` reads with fetches. Keep the zustand shapes. Stores become caches.
3. Route the endpoints in §4 through one client module (not built yet).
4. Replace `BroadcastChannel` with the `shop.status` WS (§5).
5. Extract `PaymentGateway` and implement it with PayPal JS SDK v6 (§6).
6. Strip buyer-side `floorCents` (§8).

**Open questions for the BE dev**
1. Is `lineItemId` per cart line OK, or do we need one negotiation per item?
2. Who owns `shop.status` fan-out: the API or the negotiation worker?
3. Vision: SerpAPI (Lens) or a vision model? Who pays for the calls?
4. Comps: Channel3 or SerpAPI Shopping for `median/p25/p75`?
5. Does the buyer's `rounds` preset shorten the scripted stream, or only change the LLM turn budget?
6. Is the seller's `minCents` ever sent to the BE in plaintext, or only a commitment? (Plan §9.2.1 says sealed.)
