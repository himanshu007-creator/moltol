# 0005 — DigitalOcean deploy + Render workflow adapter

**Status:** accepted

## Context

We want a real, reproducible deploy and a runner abstraction that lets the
negotiation engine run either on our own worker or on a managed workflow
service.

## Decision

The primary deploy is a single DigitalOcean droplet provisioned by Terraform:
cloud-init installs Docker, Terraform writes `.env` and runs `docker compose up`
which builds `api`/`worker`, runs migrations, and fronts everything with Caddy
(automatic HTTPS on a `nip.io` host). `--scale api=N` is the scaling lever.

Alongside it, `apps/workflow` adapts the same engine to Render Workflows
(`@renderinc/sdk`): a `haggle` task and a `NegotiationRunner` that calls
`workflows.startTask`. Both runners satisfy the same interface, so the API can
switch with config.

## Consequences

- Self-host path is fully codified and provider-token only.
- Render path is code-complete but requires a Render account/credentials to
  deploy; it is not on the critical demo path.
- Everything the engine needs is behind ports (`EngineStore`, `MarketProvider`,
  `TurnGenerator`, `NegotiationRunner`), so neither host leaks into core logic.
