# FE gap audit

Audited against the spec in the request. Verdicts are backed by grep or file reads.
`astro check`: 0 errors. `tsc --noEmit`: clean. `pnpm build`: 24 pages.

Legend: **DONE** works as specced · **PARTIAL** exists but differs from spec · **MISSING** not present.

## Baseline problems found

| # | Problem | Where | Status |
| --- | --- | --- | --- |
| B1 | Two seller models (`bazaar` seeds for buyers, `simple` store for Simple Mode) with no shared inventory | `src/stores/simple.ts`, `src/lib/mock/seeds.ts` | PARTIAL: the Modern vendor console and the buyer demo stall use `src/stores/inventory.ts`. Simple Mode still uses `simple.products`. |
| B2 | Closed stalls are hidden from discovery instead of greyed with a "Closed" chip | `src/components/discovery/ShopDiscovery.tsx`, `src/components/buyer/NearbyMap.tsx` | DONE |
| B3 | Money formats as USD while data is documented as ₹ paise | `src/lib/money.ts` | DONE (INR, en-IN) |
| B3a | 30 call sites passed `cents / 100` into `formatMoney`, so buyer prices showed 100× too small | `StallGrid`, `CartSheet`, `BazaarTheatre`, `PayFlow`, `Orders`, `Insights` | DONE |
| B3b | Cart and bazaar totals could produce fractional paise | `src/stores/cart.ts`, `src/stores/bazaar.ts` | DONE (rounded) |
| B3c | Stall page and counter page read the query string at build time, so `?id=demo-01` always showed the first stall | `src/pages/stall.astro`, `src/pages/counter.astro` | DONE (client-only) |
| B3d | Bundle saving display was ÷100 twice | `StallGrid.tsx` | DONE |
| B3e | Seller role switch used `location.href` (full reload) | `src/components/Shell.tsx` | DONE (client navigate) |
| B3f | Haggle style chosen in the cart was ignored (`style: 'polite'` hard-coded) | `src/components/buyer/CartSheet.tsx` | DONE (personality preset sent with the request) |
| B3g | Header "Start haggling" showed on mobile and overflowed the 390 px width | `src/components/astro/Header.astro` | DONE |
| B4 | Persistence is `localStorage` only; spec says IndexedDB for local data | `src/stores/*.ts` | PARTIAL: `inventory`, `venue`, `ledger`, `buyer` use IndexedDB (`src/lib/idb.ts`). `session`, `simple`, `orders`, `prefs`, `bazaar` still use localStorage. |
| B5 | Open/close does not sync across tabs | `src/stores/venue.ts` | DONE (BroadcastChannel) |
| B6 | Seeds: 7 / 8 / 7 items per shop (spec: 10–12 each) | `src/lib/mock/seeds.ts` | PARTIAL: demo stall has 12 items with varied units. Other three shops unchanged. |

## Product

| Feature | Verdict | Evidence |
| --- | --- | --- |
| One account, two roles; switch from menu, no reload | DONE | `src/stores/session.ts` `switchRole`; `src/components/Shell.tsx`; `tests/toggle-role.spec.ts` |
| Signup asks role first | PARTIAL | Role cards in `src/components/buyer/AuthForm.tsx` and `src/pages/signup.astro`; ordering not verified in-browser |
| Design tokens, fonts, grain, rangoli | DONE | `src/styles/global.css`, `src/layouts/Base.astro` |
| Surreal layer: floating lanterns, parallax, drifting price tags | MISSING | No `lantern`/`parallax` in `src/` (only the r3f Handshake and QR card) |
| Reduced-motion fallback | PARTIAL | `prefers-reduced-motion` in `global.css`, `Shell.tsx`, `Handshake.tsx`, `HaggleTheatre.tsx`; not on every animation |
| Simple vs Modern skin, persisted, toggle from menu | PARTIAL | `/simple/*` exists; `proMode` flag in `src/stores/simple.ts`; no single switch shared with the Modern vendor console |
| Voice (hi/pa/en) with tap fallback | PARTIAL | `src/lib/voice.ts` (Web Speech + tap); `src/lib/simple/strings.ts` (en/hi/pa) |

### Inventory (vendor)

| Feature | Verdict | Evidence |
| --- | --- | --- |
| Manual add form | PARTIAL | `src/components/simple/ProductCreationForm.tsx` (Simple only, no cost, no unit set) |
| CSV import with mapping and preview | MISSING | No CSV parser in `src/` |
| Voice add ("20 kilo tamatar, 30 rupaye kilo") | PARTIAL | `src/lib/voice.ts` parses prices, not a full item line |
| Snap to add (mock vision) | PARTIAL | `src/lib/vision/catalog.ts`, `src/components/simple/VegetableScanner.tsx`; not wired into inventory |
| Fields: name, category, emoji, qty, unit, pack size, COST, MIN, LIST, low-stock | PARTIAL | `SimpleProduct` has sell/floor/quantity/unit only; no cost, category, pack size, low-stock threshold |
| Unit model (`lib/units.ts`) | MISSING | Units are free strings (`'/kg'`, `'/bunch'`) in seeds; no conversion helper |
| Validation: min >= cost, list >= min, inline errors, margin preview | MISSING | No cost field exists |
| Price ruler with red min line | PARTIAL | `src/components/simple/PriceRuler.tsx` (no min line) |
| Edit, restock, adjust ±, reason, bulk edit, archive, undo toast | MISSING | Undo exists only in `src/stores/ui.ts` for takeover |
| Out-of-stock auto-hides from buyer | MISSING | Buyer stalls read static `SHOPS` products |

### Shop open/close

| Feature | Verdict | Evidence |
| --- | --- | --- |
| One big toggle in vendor header and Simple home | PARTIAL | `src/components/react/VendorStatusToggle.tsx`, `src/components/simple/StallHome.tsx` (no header placement) |
| Map pin updates for buyers immediately | PARTIAL | Closed stalls are filtered out, not shown greyed (`ShopDiscovery.tsx`, `NearbyMap.tsx`) |
| Closed chip, excluded from Nearby ordering | MISSING | Filtered out entirely |
| Closed banner and disabled Add on stall page | MISSING | No closed state in `src/components/buyer/StallGrid.tsx` |
| Cross-tab sync (BroadcastChannel) | MISSING | No `BroadcastChannel` in `src/` |
| Closing timer and auto-reopen | MISSING | Not present |
| Shared store | PARTIAL | `src/stores/venue.ts` (localStorage) |

### Ledger and intelligence

| Feature | Verdict | Evidence |
| --- | --- | --- |
| Simple: 3 cards + spoken summary | PARTIAL | `src/components/simple/SimpleEarnings.tsx`, `SELLER_DAYS` in seeds |
| Modern dashboard | PARTIAL | `src/pages/ledger.astro` is a static table from `src/lib/deals.ts` (`DEALS`) |
| AG Grid Pro ledger | MISSING | `@ag-grid-community` not installed |
| Most/least sold, highest profit, lowest margin, dead stock, low-stock alerts | MISSING | None computed |
| Revenue/profit by day, week, month | PARTIAL | `last7Days()` in `src/lib/deals.ts` only |
| Margin kept vs list, deals closed vs lost, peak hours, repeat customers | MISSING | Not computed |
| Inventory health panel with restock and min-price hints | MISSING | Not present |
| Live deals feed with Accept/Counter/Let agent handle it | PARTIAL | `src/components/simple/SimpleDeals.tsx` |
| Deal-closed moment: soundbox voice, coin drop, haptic | PARTIAL | Voice and confetti-style motion exist; no haptic (`navigator.vibrate` absent) |

## Buyer

| Feature | Verdict | Evidence |
| --- | --- | --- |
| Personality presets (Quick Deal ↔ Hard Bargain) with trade-off preview | PARTIAL | `src/components/react/PersonaPicker.tsx` uses charmer/stoic/storyteller; no "Quick Deal" or estimate preview |
| Personality editable later | PARTIAL | `src/pages/shop.astro`, `PersonaPicker` |
| Nearby map → stall → cart → Pay or Haggle | DONE | `src/components/discovery/ShopDiscovery.tsx`, `StallGrid.tsx`, `CartSheet.tsx`, `BazaarTheatre.tsx` |
| Scope sheet (all / selected) | PARTIAL | `scope` in `src/stores/bazaar.ts`; no dedicated sheet |
| Parallel haggle theatre, lane per item, sticky summary, take-over, accept all | DONE | `src/components/buyer/BazaarTheatre.tsx`, `src/stores/bazaar.ts` (`acceptAll`) |
| Merged summary | DONE | `selectBazaar` in `src/stores/bazaar.ts` |
| PayPal payment behind a `PaymentGateway` interface, labeled "Sandbox demo" | PARTIAL | `src/components/buyer/PayFlow.tsx`; no `PaymentGateway` interface; no "Sandbox demo" label |
| Success sequence: handshake, receipt unfold, proof hash-verify, tracker, rate | PARTIAL | Handshake (`src/components/theatre/Handshake.tsx`), `ReceiptView.tsx`, `Orders.tsx` tracker; rate prompt present in `PrefsControls`/`Insights` only |
| Insights: savings, streak, monthly chart (D3 + SVG), by category/shop, best time, budget bar, nudges | PARTIAL | `src/components/buyer/Insights.tsx`; D3 used only in `HaggleChart.tsx`; no month-over-month chart |
| Bottom nav: Nearby, Cart, Orders, Insights | DONE | `NAV` in `src/components/Shell.tsx` |
| Skeletons, empty and error states | MISSING | No skeleton components |
| Optimistic cart, undo toasts | PARTIAL | Undo in takeover only |
| Search and recent items | MISSING | No recent-items store (search exists in `BuyForm.tsx`) |
| Language switch | DONE | `src/components/react/PrefsControls.tsx`, `src/lib/i18n.ts` |
| Gamification: tension bar, commentator, predictions, XP/badges, Fun mode | PARTIAL | Terms appear in `Shell.tsx`, `HaggleTheatre.tsx`, `ReceiptView.tsx`, `ShopDiscovery.tsx`; no XP/badge store, no predictions |

## Cross-cutting

| Rule | Verdict | Evidence |
| --- | --- | --- |
| Seller min and buyer max never rendered before reveal | DONE (by grep) | No `floorCents` in `src/components/buyer`, `src/components/theatre`, `src/components/discovery`. Re-verify in step 6. |
| Money as integer minor units with Intl formatting | PARTIAL | `src/lib/money.ts` is integer-based but USD (see B3) |
| Module-level Zustand across islands | DONE | `src/stores/*` |
| `transition:persist` on haggle island | MISSING | No `transition:persist` in `src/` |
| No runtime dynamic routes (`?id=`) | DONE | `src/pages/haggle.astro`, `receipt.astro` |
| r3f, map, AG Grid client-only and lazy | PARTIAL | r3f `client:only` in `src/pages/haggle.astro`; the map is Leaflet, not MapLibre, and is not `client:only` |
| One WebGL context at a time | PARTIAL | Handshake plus QR card can mount together; not enforced |
| Perf: initial JS < 200 KB gz | NOT MEASURED | To measure in step 5 |
| A11y: aria-live for offers, keyboard, axe | PARTIAL | `Transcript.tsx` aria-live; axe spec exists in `tests/a11y.spec.ts` |
| Seeds: 3 shops, 10–12 items each with varied units | PARTIAL | 3 shops; items 7/8/7 (see B6) |
| 3 months order history | PARTIAL | `BUYER_HISTORY` in `src/lib/mock/seeds.ts` (check month count in step 4) |
| 2 scripted parallel-haggle fixtures | PARTIAL | `src/fixtures/haggle-01.json` plus `buildCartScript` |
| Replay mode labeled | DONE | `replay` status in `src/lib/ws.ts` |
| Demo logins "Demo buyer" / "Demo seller" | MISSING | Demo user is "Reema" (`DEMO_USER` in seeds, README) |
| IndexedDB storage | MISSING | See B4 |
| BE_HANDOFF.md | MISSING | |
| README "Run the full demo (mock mode)" / "Wiring the backend" | MISSING | README has Quickstart and a seam table only |
| Playwright suites | PARTIAL | 5 specs in `tests/` (buyer, seller, toggle role, discovery, scan, a11y). Not yet updated for the new flows. |
| MapLibre instead of Leaflet | MISSING | Leaflet in use (`ShopDiscovery.tsx`) |
| AG Grid | MISSING | Not installed |
| SerpAPI-backed vision stand-in | MISSING | Mock vision only in `src/lib/vision/catalog.ts` |

## Status after this pass

| Step | Done | Not done |
| --- | --- | --- |
| 0 Audit and fixes | This file. Fixed the money unit bugs, stall and counter query bugs, role-switch reload, header overflow. `tsc`, `astro check`, build all clean. | |
| 1 Inventory | `src/lib/units.ts`, `src/lib/inventory.ts` (zod schema, price rules, voice parser, CSV reader and mapping, snap stand-in), `src/stores/inventory.ts`, `src/components/vendor/*`, `/inventory`. Demo stall reads from it. | Simple Mode still on its own product store. Hindi and Punjabi labels on the vendor console. |
| 2 Open/close and live sync | Header switch, timers (close in N, reopen in N, cancel), BroadcastChannel, closed pins greyed, closed section outside the Nearby order, closed banner and disabled Add on the stall page. | MapLibre (still Leaflet). Auto-reopen at a clock time (only in N minutes). |
| 3 Ledger intelligence | `src/lib/ledger.ts` (pure functions, formulas in BE handoff §7), `src/stores/ledger.ts` (90-day seed), D3 period chart, `/ledger` dashboard, hints with one-tap action. | AG Grid Pro (not installed). Simple Mode 3 cards and spoken summary. Peak-hours and repeat-customer names only come from seeded history. |
| 4 Buyer personality and insights | Presets `quick/balanced/hard` with mock estimates, per-basket override, saved default in IndexedDB, request carried on the haggle. Insights rewritten with correct totals, budget bar, D3 chart, price nudge, streak. | Personality at signup. Rounds preset does not yet shorten the scripted lanes. Best time or day to buy. Re-order shortcut. Scope sheet (selected items). Gamification store (XP, badges, predictions). |
| 5 Visual polish and QA | Header overflow fixed. Layout checked at 390 px for inventory, ledger and buyer pages (no horizontal scroll). | Floating lanterns, parallax, drifting price tags (not built). Reduced-motion fallback on every animation. QA at 360, 768, 1280 px. |
| 6 Tests | `tests/vendor-flow.spec.ts` (add item with price rule, close stall, buyer sees it live, CSV preview). Existing suites updated for the new behaviour. axe spec covers seven routes. Desktop and mobile projects. | Lighthouse mobile not run. Demo logins still named Reema. |
| 7 Docs | `docs/BE_HANDOFF.md` (entities, endpoints, realtime, PayPal, analytics, security, swap checklist). README sections "Run the full demo (mock mode)" and "Wiring the backend". | |

Measured: largest lazy chunk (Handshake, r3f and three) is 249 KB gz, loaded only on haggle. Initial JS
for the buyer routes was not measured separately. Simple Mode budget (< 120 KB) not verified.
