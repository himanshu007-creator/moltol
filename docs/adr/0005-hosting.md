# 0005 — AWS (EC2) deploy

**Status:** accepted

## Context

We want a real, reproducible self-hosted deploy with HTTPS, so a judge can hit a
public URL and watch a negotiation run live without docker knowledge.

## Decision

The deploy is a single AWS EC2 instance (ap-southeast-2 Sydney, the only region
the account's Free-plan SCP permits) with an Elastic IP, provisioned by Terraform:
cloud-init installs Docker, Terraform snapshots the local source into a tarball,
uploads it with `.env`, and runs `docker compose up` which builds `api`/`worker`,
runs migrations, and fronts everything with Caddy (automatic HTTPS on a `nip.io`
host). `--scale api=N` is the scaling lever; `--scale worker=N` scales the runner.

## Consequences

- Self-host path is fully codified; no provider tokens beyond the AWS profile.
- Deploys from the local source tarball, so no git repo/credentials are needed on
  the instance.
- Limited to the Free-plan's eligible instance types and regions (t3.small in
  ap-southeast-2), which is fine for the demo.
- Everything the engine needs is behind ports (`EngineStore`, `MarketProvider`,
  `TurnGenerator`, `NegotiationRunner`), so the host never leaks into core logic.

## Superseded

An earlier version of this ADR also described a Render Workflows adapter
(`apps/workflow`, `@renderinc/sdk`). That path was never deployed and has been
removed; the BullMQ worker in `apps/worker` remains the single runner.