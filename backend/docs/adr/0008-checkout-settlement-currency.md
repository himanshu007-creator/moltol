# 0008 — Checkout settles in the gateway's currency (INR → USD)

**Status:** accepted (2026-10-18)

## Context

Shops price in their own currency (INR by default), and every amount in the
system — basket lines, sealed limits, proofs, the ledger — is in that currency.
But PayPal does not support INR (it withdrew domestic India payments and INR is
not a REST currency), so a real PayPal order created in INR is rejected. The
frontend is India-first, so running the whole bazaar in USD to satisfy PayPal
would be the tail wagging the dog.

## Decision

- **The deal stays in the shop's currency; only the charge is converted.** At
  checkout the basket total (INR) is quoted in the gateway's currency
  (`PAYPAL_SETTLEMENT_CURRENCY`, default `USD`) at `FX_USD_PER_INR` (default
  `0.012`, ~₹83.33 = $1). The PayPal order is created for the converted amount;
  nothing about the haggle, the guard, or the proof changes.
- **The conversion is explicit and recorded.** `packages/contracts`
  `settleAmount` is a pure function (minor-unit multiplier, rounded). The
  `payments` row now stores the charge (`amountCents`/`currency`) **and** the deal
  (`dealAmountCents`/`dealCurrency`) and the `fxRate` used; the checkout response
  carries `deal` and `fxRate` so the UI can show "₹4,000 ≈ $48.00".
- **The rate is a configured constant, not a live quote.** Deterministic and
  auditable; a live FX provider can slot in behind `settle` later. Only the
  `INR→USD` pair is wired; an unknown pair is passed through unchanged so the
  gateway rejects it honestly rather than the API inventing a rate.
- **Same-currency shops are untouched** (`rate = 1`): a USD shop's charge equals
  its deal.

## Consequences

- A live PayPal demo now works with an INR-priced bazaar; the mock gateway (no
  keys) still settles any currency, so dev/CI is unchanged.
- The rate is a snapshot at deploy time — a stale `FX_USD_PER_INR` silently
  misprices every charge, so it should be set before a live run (or the demo run
  in `USD`).
- Reporting sees two currencies: the ledger frames revenue in the shop's currency
  (INR, from basket lines) while PayPal's own reporting returns the charged
  currency (USD). Reconciling them is left to the reader of both.
