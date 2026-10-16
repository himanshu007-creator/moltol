# 0002 — Sealed limits via commit–reveal

**Status:** accepted

## Context

The whole point of MolTol is that neither side can breach its own limit, and
neither side can learn the other's limit. A limit in the database is not enough:
the other agent, the LLM prompt, or the wire could leak it.

## Decision

Each side's limit is stored only in a sealed vault. We publish a commitment
`sha256(negotiationId|side|currency|limitCents || salt)` up front (`limits.sealed`)
and never the limit. After settlement, the vault reveals the limit and salt so
anyone can verify the commitment (the Proof of Fair Deal). Read/write limits
happen only through `packages/store`'s sealed vault; limits are never put in an
LLM prompt, a log line, or an event with `audience: "all"`.

## Consequences

- The commitment is bound to the negotiation and side, so it cannot be reused.
- Proof of Fair Deal is independently checkable from the event log + vault.
- At rest, the vault can be AEAD-sealed with `SEAL_KEY` (optional in the demo).

## Amended (2026-10-16)

- The reveal happens only once the deal is **paid**: `GET …/proof` answers 409 before
  that (it used to reveal right after agreement and append a new `proof.revealed` on
  every call). `proof.revealed` is emitted exactly once and now carries the limits and
  salts, so a client can recompute the commitments itself.
- `deal.agreed` no longer carries `fairness`: it is a function of both limits, so with
  the price and its own limit either side could solve for the other's limit before
  settlement. Fairness ships with the proof.
- A guard `verdict` that rejected a proposal for breaching a sealed limit (rather than
  the ±band) is addressed to the acting side only, not the public stream: the rejected
  number brackets the limit to within the band.
- A seal is never replaced (first writer wins), so the commitment on the wire always
  matches the vault.
