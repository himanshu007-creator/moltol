# MolTol — Backend

> *Where agents haggle and PayPal settles.*
> Agent-to-agent negotiation, settled through PayPal.

This directory is the **`backend/`** of the [`moltol`](https://github.com/sanujsood/moltol)
repo (the `frontend/` will live alongside it). It contains the confirmed
**backend scaffold** for MolTol: a TypeScript monorepo with
two deployable images (`api`, `worker`), a Docker stack (Postgres + Redis + Caddy),
and Terraform that provisions a DigitalOcean VM and deploys the stack behind a free
[`nip.io`](https://nip.io) hostname.

```
apps/api      Fastify REST API (health, negotiations, queue producer)
apps/worker   Negotiation runner (Redis consumer -> Postgres)
packages/contracts   zod schemas = single source of truth (FE + BE)
packages/policy      deterministic negotiation engine (pure, unit-tested)
infra/caddy          reverse proxy + load balancer + TLS
infra/terraform      DigitalOcean VM + Docker deploy
```

The core idea (see `packages/policy`): **the LLM proposes, policy disposes.** Every
price comes from a pure policy function, never the model, and each side seals its
limit with a commit–reveal hash so a *Proof of Fair Deal* can be verified afterward.

## Prerequisites

- Node 20+ · pnpm 9 (`corepack enable pnpm`)
- Docker (for the stack) · Terraform 1.6+ (for the cloud deploy)

## Local development

```bash
pnpm install

# Bring up only the data services
docker compose up -d postgres redis

# Copy env and run api + worker with hot reload
cp .env.example .env
pnpm dev            # turbo runs apps/api and apps/worker
```

- API: http://localhost:3000
- `GET /healthz` liveness · `GET /readyz` checks Postgres + Redis · `GET /v1/version`

### Try the flow

```bash
# Start a haggle
curl -s -X POST localhost:3000/v1/negotiations \
  -H 'content-type: application/json' \
  -d '{"query":"stainless 1L water bottle","persona":"analyst","maxTotalCents":4000}'

# Read the settled negotiation (the worker fills in turns + agreed price)
curl -s localhost:3000/v1/negotiations/<id>
```

## Run the full stack in Docker

```bash
cp .env.example .env      # set POSTGRES_PASSWORD
docker compose up -d --build --scale api=3
curl localhost/healthz
```

Caddy load-balances across every `api` replica using a dynamic DNS upstream, so
you can change the api container count at any time:

```bash
docker compose up -d --scale api=5      # scale up
docker compose up -d --scale api=1      # scale down
```

## Deploy to DigitalOcean (Terraform + nip.io)

Terraform creates a droplet, installs Docker (cloud-init), clones this repo on the
VM, builds both images, and starts the stack. The API is published at
`https://api.<droplet-ip>.nip.io` — no domain purchase, Caddy gets the TLS cert.

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # set do_token + repo_url

# ssh key that will be registered with DO + used to provision
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519     # only if you don't have one

terraform init
terraform plan
terraform apply
```

Outputs:

```
droplet_ip  = 164.90.x.x
app_url     = https://api.164.90.x.x.nip.io
health_url  = https://api.164.90.x.x.nip.io/healthz
```

### Change the number of API containers

```bash
terraform apply -var="api_replicas=4"
```

`api_replicas` and `worker_replicas` are Terraform variables; the deploy script
passes them to `docker compose --scale`. Caddy picks up the new replicas within
~5s (dynamic DNS refresh) with no config change.

Tear it down with `terraform destroy`.

## How the deploy works

1. **cloud-init** installs Docker + the compose plugin on first boot.
2. A `null_resource` uploads a generated `.env` (random Postgres password) and a
   `deploy.sh`, then over SSH clones the repo, runs `docker compose build`, and
   `docker compose up -d --scale api=N`.
3. **Caddy** terminates TLS for the nip.io host and round-robins to the api replicas.

Everything is sandbox-safe: no live credentials, `.env` is generated per deploy and
never committed.

## Scripts

| Command | What it does |
|---|---|
| `pnpm build` | Turbo build of every package |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm test` | Vitest (policy engine has 13 tests) |
| `pnpm docker:up` | `docker compose up -d` |
| `pnpm docker:down` | `docker compose down` |

## Roadmap (from the master plan)

The scaffold gives you the deployment spine. Next: PayPal gateway (Orders v2 +
webhooks + Agent Toolkit), Channel3 market comps, live WebSocket event stream,
commit–reveal storage, and the LLM turn-text layer — all of which slot into the
worker/API without changing this infrastructure.
