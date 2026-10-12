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
