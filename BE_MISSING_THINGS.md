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

**Update, 2026-10-25:** Inventory model extended (migration `0010_modern_inventory`), soft-delete/archive support, stock adjustments with audit trail, `locationUpdatedAt` on shops, `POST /v1/shops/me/items/:id/adjust` endpoint added. Channel3 API fixed to use `api.trychannel3.com` with correct auth. `POST /v1/search/products` added for FE compatibility. Standalone negotiation now always converges (Option A) — engine clamps floor for standalone demo. Demo works without photo storage (snap uses inline data URLs).

