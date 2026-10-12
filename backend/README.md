# MolTol (मोल-तोल)

> **Where agents haggle, and PayPal settles.**
> Agent-to-agent negotiation with a deterministic, sealed-limit fairness guarantee.

MolTol lets two autonomous agents (a **buyer** and a **shop**) haggle over a price,
then settles the agreed deal through **PayPal Orders v2** — with a verifiable
**Proof of Fair Deal** that neither agent could have breached its own sealed limit.

The guiding rule is simple: **the LLM proposes, policy disposes.** An LLM only ever
writes *wording*. Every number — anchors, counter-offers, acceptance, the final
price — comes from a pure, unit-tested policy package. Each side seals its private
limit with a hash commitment before the first turn, so the deal can be verified
afterwards without ever revealing the limits mid-negotiation.

## Repository layout

```
apps/api          Fastify REST API + SSE event stream + PayPal checkout/webhook
apps/worker       Negotiation runner (BullMQ) + timeout sweeper
packages/contracts  zod schemas + event envelope + state machine (FE ⇄ BE source of truth)
packages/policy     pure negotiation engine: concessions, guard, commit–reveal, range proofs
packages/engine     runHaggle(): orchestrates policy + LLM wording + event log
packages/store      Drizzle schema + migrations + repositories (Postgres)
packages/paypal     OAuth token cache, Orders v2 create/capture, webhook self-verification
packages/market     market comps (Channel3 client + deterministic seeded fallback)
packages/llm        LLM turn-text adapter (OpenAI-compatible, with canned fallback)
infra/caddy         reverse proxy + load balancer + automatic TLS
infra/terraform     AWS (EC2) + Docker deploy (self-host option)
```

## Hard invariants

- **Money is integers.** Prices are integer minor units (cents) + ISO-4217 currency. Never floats.
- **Limits never leave the vault.** Sealed limits are never logged and never placed in an LLM prompt.
- **The guard always wins.** A price that would breach a side's sealed limit is rejected and the policy price is used instead.
- **PayPal POSTs are idempotent.** Every order/capture carries a `PayPal-Request-Id`; webhooks are processed once by event id.
- **The event log is append-only and replayable.** Runner state is derived from events, so a crashed worker resumes.

## Quick start

```bash
corepack enable pnpm
pnpm install
cp .env.example .env          # set POSTGRES_PASSWORD; PayPal keys optional in dev

docker compose up -d postgres redis
pnpm --filter @moltol/store db:migrate
pnpm dev                      # api + worker with hot reload
```

- API: http://localhost:3000
- `GET /healthz` · `GET /readyz` · `GET /v1/version`
- `POST /v1/negotiations` → `{ id }`
- `GET /v1/negotiations/:id/events?after=0` → **SSE** stream of the running haggle

### Run the whole stack in Docker

```bash
cp .env.example .env          # set POSTGRES_PASSWORD
docker compose up -d --build --scale api=3
curl localhost/healthz
```

Caddy front-proxies every `api` replica with a dynamic DNS upstream, so you can
re-scale at any time (`--scale api=5`).

## PayPal integration

The buyer's checkout is a PayPal **Orders v2** flow; the agreed price is captured only
after approval, and a **webhook** reconciles the capture out-of-band (so a dropped
approve callback still settles). Webhooks are verified with PayPal's
self-verification recipe: an RSA signature over `transmissionId|timestamp|webhookId|crc32`
where `crc32` is the **unsigned decimal CRC-32 of the raw body** (Node's `zlib.crc32`).
Simulated webhooks self-verify against the literal webhook ID `WEBHOOK_ID`.

Set `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`,
and `PUBLIC_BASE_URL=https://<your-https-host>` (PayPal only delivers to HTTPS :443 —
use a tunnel locally).

## Deploy (self-host on AWS)

```bash
# Credentials via the standard chain: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
# (or AWS_PROFILE / ~/.aws/credentials).
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # set region/instance_type + your SSH key paths
terraform init && terraform plan && terraform apply
```

Provisions an EC2 instance (default region `ap-southeast-2` = Sydney, the only
region the AWS Free-plan grants this account) with an Elastic IP, a security group
(22/80/443), and cloud-init that installs Docker. Terraform snapshots your local
workspace into a tarball, uploads it with `.env`, and runs `docker compose up`, so
**no git repo or credentials are needed on the instance**. The API is published at
`https://api.<elastic-ip>.nip.io` (free DNS, automatic TLS).
`terraform destroy` tears it down.

## Scripts

| Command | What it does |
|---|---|
| `pnpm build` | Turbo build of every package |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm test` | Vitest (policy guard, engine, PayPal webhook verify) |
| `pnpm db:migrate` | Apply Drizzle migrations |
| `pnpm lint` | Prettier check |
| `pnpm docker:up` | `docker compose up -d` |

## License

MIT — see [LICENSE](./LICENSE).
