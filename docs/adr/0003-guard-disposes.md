# 0003 — The policy guard always disposes

**Status:** accepted

## Context

LLMs write persuasive text and sometimes propose prices. We want the LLM's
fluency without ever letting it move money past a limit.

## Decision

The LLM only returns wording plus a price suggestion. Every price that reaches
the wire is produced by `packages/policy` and passed through `validateOffer` for
the acting side. If the proposal is outside the allowed band, the guard clamps
or rejects it, falls back to the policy price, and emits a `verdict` event with
`ok: false`. The guard runs in the engine, not in the model.

## Consequences

- A misbehaving or jailbroken model cannot breach a sealed limit.
- The `verdict` events make the guard's work visible in the demo stream.
- The LLM port (`TurnGenerator`) stays tiny and easy to fake in tests.
