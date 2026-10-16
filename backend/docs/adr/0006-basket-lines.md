# 0006 — Baskets: one negotiation per line, against the vendor's real limits

**Status:** accepted (2026-10-16)

## Context

The frontend's core loop is a basket: a buyer haggles every item in it against
one shop, in parallel lanes, can take any lane over mid-haggle, and pays once.
The engine was built for one query against a shop derived from market comps,
ran a whole negotiation in one go, and could end with no deal. Vendors now set
real list and lowest prices (`shop_items`), so the negotiation has to run
against those.

## Decision

- **A basket line is a negotiation.** `POST /v1/baskets` creates one basket row and
  one `negotiations` row per line, and seals both limits for every line in the same
  transaction. A line's id is its `lineItemId`, so the existing event union, commit–
  reveal, guard, and proof apply unchanged, per line. The basket stream multiplexes
  the lines' logs; the basket is checked out as one PayPal order.
- **Limits come from the vendor and the sticker.** The buyer's sealed ceiling is the
  item's list price. The shop's sealed limit is a per-line *reserve* drawn at random in
  [floor + one unit, floor + 30% of (list − floor)] — not the vendor's standing
  `floorCents`, which never leaves the server. The shop's concession curve is public
  and deterministic, so its counters reveal the limit it concedes toward; conceding
  toward a one-off reserve means they reveal that, not the vendor's floor, and so does
  the post-payment proof. The API enforces floor ≤ list, so every line has a zone of
  agreement and always closes on a price in [reserve, list] — the frontend's
  "haggling over something already in the basket lands on a price", made true by
  construction rather than by tuning.
- **The runner is step-based.** Each iteration rebuilds state from the event log,
  plans one step (an opening, an offer, a counter, an accept), and commits it
  atomically with the seq it expects (`commitStep`, serialized per negotiation by an
  advisory lock). Agent steps are refused while a human controls the line. A human
  takeover, counter, or accept is a step through the same path, so the agent and the
  human can never interleave, and a takeover during the agent's pause simply makes
  its pending step fail.
- **Pacing lives in the worker** (`TURN_DELAY_MS`), so a haggle streams at a pace a
  person can watch and step into.

## Consequences

- Takeover, human offers, accept, and accept-all are real server actions; the guard
  holds a human to the same sealed ceiling as the agent.
- A crashed worker resumes mid-haggle from the log; nothing is regenerated.
- The final round no longer sends the buyer to its own ceiling, and a shop that can't
  accept walks away without naming a price — neither limit is announced mid-haggle.
- The proof reveals the line's reserve, never the vendor's floor. Across many paid
  baskets the lowest revealed reserves approach the floor — inherent to any seller who
  sometimes sells near their floor. Buyers save a little less than if the shop conceded
  all the way (on average 15% of the list–floor gap); `RESERVE_SPREAD` tunes that.
- Per-line negotiations cost one LLM-narrated haggle each; baskets are capped at 12
  lines and rate-limited per buyer.
