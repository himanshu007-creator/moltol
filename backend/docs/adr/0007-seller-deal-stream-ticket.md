# 0007 — Seller live feed: a short-lived ticket for the deal stream

**Status:** accepted (2026-10-18)

## Context

A busy stall wants its dashboard to light up the moment an offer lands and the
moment a lane closes — the same "firehose" the buyer already gets on
`GET /v1/baskets/:id/events`. The basket stream can be public because the basket
id is an unguessable capability and the events it carries are `audience: "all"`.
A seller's feed is different: it is scoped to one shop and carries only that
shop's offers, so it must be authorized, not merely unguessable.

The obstacle is `EventSource`: a browser cannot attach an `Authorization` header
to it. The existing `GET /v1/shops/status/stream` sidesteps this because shop
status is public, but a private seller feed cannot.

## Decision

- **A shop-scoped ticket in the query string.** `POST /v1/shops/me/deals/ticket`
  (authenticated) mints a JWT signed with the same secret, carrying
  `{ shopId, scope: "seller-stream" }` and expiring in 120 s. The client passes it
  as `GET /v1/shops/me/deals/stream?ticket=…`. The ticket is verifiable but
  useless for anything else: it has no session `sub`/`tv`/`jti`, so
  `authenticate` rejects it, and 120 s bounds the exposure of a leaked URL.
- **The JWT payload type is widened, not duplicated.** `FastifyJWT.payload`
  makes the session claims optional so one signer can mint both a session token
  and a stream ticket; `user` (what `req.user` sees) stays strict, and
  `authenticate` still demands a real `sub`/`tv`/`jti`.
- **The feed is a Redis fan-out, not a database poll.** Closing events
  (`deal.agreed`, `session.ended`) are mirrored into `moltol:deals:<shopId>` from
  both publishers — the API's `container.publish` and the worker's publish wrapper
  — so a lane closing on either process reaches the seller. The mirror looks up
  `store.lineContext(negotiationId)` only for closing events, so hot-path offer
  traffic pays nothing.
- **`deal.incoming` is published at basket create**, when the lanes are tied to a
  shop and cart total.

## Consequences

- The seller feed reuses the existing SSE plumbing (`streamShopDeals`) and the
  event union (`DealFeedEvent`: `deal.incoming` | `deal.closed`).
- Independent negotiations (not attached to a basket) have no `lineContext`, so
  they never appear in a shop feed — correct, since they are not a shop's deal.
- A ticket is a bearer credential for a 2-minute window; the client should fetch a
  fresh one per reconnect (which `EventSource` does on its own retry).
