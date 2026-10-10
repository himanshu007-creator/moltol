# 0004 — Append-only, ordered event log

**Status:** accepted

## Context

Negotiations run in a worker that can restart, and the UI needs to stream turns
live. We need one story for "what happened" that survives crashes and partial
writes.

## Decision

Every negotiation has an append-only event log with a monotonic `seq` per
negotiation. `runHaggle` rebuilds its state from the log and skips `seq <
nextSeq`, so a retry resumes instead of duplicating. SSE streams backfill from
the log then tail Redis; clients can reconnect with `?after=<seq>` and miss
nothing.

## Consequences

- Restarts and duplicate jobs are safe (idempotent by construction).
- The event log is the audit trail the proof is computed from.
- Webhook handling dedupes by PayPal event id before writing anything.
