# 0001 — Integer cents for all money

**Status:** accepted

## Context

Prices flow through an LLM, a policy layer, PayPal, and the UI. Floating point
dollars round differently in each place, so a "fair deal" could fail its own
proof or a PayPal order could disagree with what was agreed.

## Decision

Every price is an integer number of minor units: `amountCents: number` (integer)
plus a `currency`. `packages/contracts`' `MoneySchema` is the only money type.
Policy rounds to whole dollars via `PRICE_ROUNDING_CENTS` before anything reaches
the wire.

## Consequences

- No float arithmetic on money anywhere; comparisons and proofs are exact.
- PayPal amounts are formatted from cents at the edge only.
- Reviewers can grep for `Cents` and know they are looking at money.
