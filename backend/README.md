# MolTol (मोल-तोल)

> **Where agents haggle, and PayPal settles.**
> Agent-to-agent negotiation with a deterministic, sealed-limit fairness guarantee.

MolTol lets a buyer's agent haggle with a shop's agent over every line of a basket
at once, then settles the agreed prices through **PayPal Orders v2** — with a
verifiable **Proof of Fair Deal** that neither agent could have breached its own
sealed limit.

The guiding rule is simple: **the LLM proposes, policy disposes.** An LLM only ever
writes *wording*. Every number — anchors, counter-offers, acceptance, the final
price — comes from a pure, unit-tested policy package. Each side seals its private
limit with a hash commitment before the first turn, so the deal can be verified
afterwards without ever revealing the limits mid-negotiation.

## Repository layout

```
apps/api          Fastify REST API + SSE event streams + PayPal checkout/webhook
apps/worker       Negotiation runner (BullMQ) + timeout sweeper
packages/contracts  zod schemas + event envelope + state machine (FE ⇄ BE source of truth)
packages/policy     pure negotiation policy: concessions, guard, commit–reveal, range proofs
packages/engine     the step-based haggle: agent runner + human takeover over one event log
packages/store      Drizzle schema + migrations + repositories (Postgres)
packages/paypal     OAuth token cache, Orders v2 create/capture, webhook self-verification
packages/market     market comps (Channel3 + SerpAPI clients + deterministic seeded fallback)
packages/llm        LLM turn-text adapter (OpenAI-compatible, with canned fallback)
infra/caddy         reverse proxy + load balancer + automatic TLS
infra/terraform     AWS (EC2) + Docker deploy (self-host option)
```

## Hard invariants

- **Money is integers.** Prices are integer minor units (cents/paise) + ISO-4217 currency. Never floats.
- **Limits never leave the vault before settlement.** Not in a prompt, a log line, a
  public event, or a number derived from both limits (fairness ships only with the proof).
- **The guard always wins.** A price that would breach a side's sealed limit is rejected and the policy price is used instead.
- **PayPal POSTs are idempotent.** Every order/capture carries a `PayPal-Request-Id`; webhooks are verified and processed once by event id.
- **The event log is append-only and replayable.** Every step commits atomically with the
  seq it expects; state is rebuilt from the log, so a crashed worker resumes.

See [`AGENTS.md`](./AGENTS.md) and the [ADRs](./docs/adr/README.md).

## Quick start

```bash
corepack enable pnpm
pnpm install
cp .env.example .env          # set POSTGRES_PASSWORD and JWT_SECRET (openssl rand -hex 32)

docker compose up -d postgres redis
pnpm --filter @moltol/store db:migrate
pnpm dev                      # api + worker with hot reload
```

- API: http://localhost:3000 · Swagger UI: http://localhost:3000/docs
- `GET /healthz` · `GET /readyz` · `GET /v1/version`

No external keys are needed: PayPal, the LLM, market comps, photo snap, and email
all have offline fallbacks (mock checkout, a canned narrator, seeded comps, a
built-in item catalogue, OTP codes in the API log). Add `LLM_BASE_URL` /
`LLM_API_KEY` / `LLM_MODEL` for live turns + vision, and `CHANNEL3_API_KEY` or
`SERPAPI_API_KEY` for live market comps.

### Run the whole stack in Docker

```bash
cp .env.example .env          # set POSTGRES_PASSWORD and JWT_SECRET
docker compose up -d --build --scale api=3
curl localhost/healthz
```

Caddy front-proxies every `api` replica with a dynamic DNS upstream, so you can
re-scale at any time (`--scale api=5`). With `NODE_ENV=production` the API
refuses to start without a real `JWT_SECRET`.

## The basket haggle (what the frontend calls the bazaar)

A buyer haggles every line of a basket against one shop in parallel. Each line
is its own negotiation — own sealed limits, event log, and proof — and its id is
the line's `lineItemId`.

| Step | Call |
| --- | --- |
| Vendor sets up | `POST /v1/shops/me` (name, emoji, persona, location) · `POST /v1/shops/me/items` (list `sellCents` ≥ lowest `floorCents`) · `PUT /v1/shops/me/status` (open/close, timers) |
| Vendor moves | `PATCH /v1/shops/me/location {lat,lng}` — the live pin while the stall is out; `nearby` carries `locationUpdatedAt` |
| Vendor adds | `POST /v1/inventory/snap {image, hint?}` — a photo data URL → suggested items (`source: vision` or `catalogue`), the vendor confirms and prices |
| Buyer finds stalls | `GET /v1/shops/nearby?lat&lng&radiusM` (open by distance, closed last) · `GET /v1/shops/:id` (no floors) · `GET /v1/shops/status/stream` (SSE `shop.status`) |
| Start | `POST /v1/baskets` `{shopId, lines:[{itemId, qty}], request:{rounds, tone, preset}}` |
| Watch | `GET /v1/baskets/:id/events` — one SSE stream of every lane, paced ~0.9 s per turn |
| Step in | `POST /v1/baskets/:id/lines/:lineItemId/takeover` · `…/offer {priceCents}` · `…/accept` · `POST /v1/baskets/:id/accept-all` |
| Pay | `POST /v1/baskets/:id/checkout` (one PayPal order for the basket) → approve in PayPal → `POST /v1/baskets/:id/capture` |
| Retry | `POST /v1/baskets/:id/retry` — after a failed payment, a fresh PayPal order for the same lanes |
| Prove | proofs return from capture; `GET /v1/baskets/:id/proof`; `proof.revealed` on the stream |
| History | `GET /v1/orders` · `GET /v1/orders/:id` (buyer) · `GET /v1/shops/me/deals?since=` (seller) |
| Books | `GET /v1/ledger?period=` · `GET /v1/ledger/summary` · `POST /v1/ledger/ask {question}` · `GET /v1/insights/buyer` |
| Seller feed | `POST /v1/shops/me/deals/ticket` → `GET /v1/shops/me/deals/stream?ticket=` (SSE `deal.incoming` / `deal.closed`) |

**Every line lands on a price.** On a basket line the buyer's sealed ceiling is the
shop's list price and the shop's sealed limit is a per-line reserve drawn at random
between the vendor's lowest price (+₹1) and 30% of the way to the list price — so
the zone of agreement always exists, the vendor never sells below their floor, and
neither the shop's (public, deterministic) concession curve nor the post-payment
proof ever reveals the vendor's standing floor. The buyer agent concedes up from a market anchor, the shop agent down
from its list price; in the last round the buyer meets the shop's standing ask.
A human who takes a lane over is held to the same ceiling by the guard, and the
shop never walks away from them: it holds its last concession (above its floor)
until the buyer accepts.

**Haggle request.** `rounds` (2–12) is patience; `tone` sets how fast the buyer
agent concedes (`polite` → quick, `playful` → middle, `firm` → holds late). The
shop's `persona` does the same for its side.

**Streams.** Events are the `NegotiationEvent` union in `packages/contracts`. A
basket stream carries every lane's public (`audience: "all"`) events; route each
by `negotiationId` (= `lineItemId`). Each frame's `id:` is the dot-joined last
seq of every lane, which an `EventSource` sends back as `Last-Event-ID` on
reconnect, so nothing is replayed or missed. The basket id is the capability
for its stream (an `EventSource` can't send an `Authorization` header).

**Auth.** `POST /v1/auth/signup` → emailed 6-digit code → `POST /v1/auth/otp/verify`
→ JWT (expires after `JWT_TTL`). `POST /v1/auth/logout` revokes that session; a
password reset revokes all of them. `PATCH /v1/me/role` and
`PUT /v1/me/preferences/haggle` store the dual-role view and the default haggle
style. Auth endpoints are rate-limited per client IP, baskets per user.

The original single-negotiation demo (`POST /v1/negotiations` with a `query` and
`maxTotalCents` against a market-derived shop, then `…/checkout`, `…/capture`,
`…/proof`, `…/events`) still works as before, and — like a basket line — always
lands on a price: the derived shop's sealed floor is capped just below the
buyer's own ceiling (`STANDALONE_FLOOR_HEADROOM`), so a zone of agreement exists
by construction. Caveat: when the budget sits below the market floor, the deal
closes at the buyer's ceiling and the proof's fairness number reflects the clamp
rather than a real haggle.

## PayPal integration

The buyer's checkout is a PayPal **Orders v2** flow: one CAPTURE-intent order per
basket, captured only after approval. Only a capture PayPal reports as
`COMPLETED` settles (`PENDING` answers 202 and waits; `DECLINED` fails the
payment). A webhook is only a trigger: the API re-asks PayPal (an idempotent
capture with the same `PayPal-Request-Id`) and acts on PayPal's answer, never on
the webhook body — so a forged or replayed event can't settle anything, and a
dropped approve callback still settles. Without PayPal keys, checkout is an
offline mock; production refuses it unless `ALLOW_MOCK_PAYMENTS=true`.

Webhooks are verified with PayPal's self-verification recipe: an RSA signature
over `transmissionId|timestamp|webhookId|crc32`, where `crc32` is the unsigned
decimal CRC-32 of the **raw** body and the key comes from PayPal's cert (https,
`*.paypal.com`, no redirects). Simulator events are signed too — with the
literal webhook id `WEBHOOK_ID` — and are accepted in sandbox only after the
same signature check.

Set `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`,
and `PUBLIC_BASE_URL=https://<your-https-host>` (PayPal only delivers to HTTPS :443 —
use a tunnel locally).

### PayPal and INR (settlement conversion)

Shops price in `DEFAULT_CURRENCY` (default `INR`, matching the frontend), and the
deal keeps INR amounts everywhere — lines, proofs, ledger. PayPal does not support
INR, so **checkout converts**: the order is charged in
`PAYPAL_SETTLEMENT_CURRENCY` (default `USD`) at `FX_USD_PER_INR`
(default `0.012`, i.e. ~₹83.33 = $1). Both sides are recorded: the payment row
stores the gateway charge (`amountCents`/`currency`) plus the deal total
(`dealAmountCents`/`dealCurrency`) and the `fxRate` used, and the checkout
response carries `deal` and `fxRate` so the UI can show "₹4,000 ≈ $48.00".

The rate is a configured constant, not a live quote — deterministic and
auditable for a demo. Set `FX_USD_PER_INR` to the current rate before a live run,
or leave `PAYPAL_SETTLEMENT_CURRENCY=INR` to see PayPal reject an unsupported
currency honestly. Only the `INR→USD` pair is wired; an unknown pair is passed
through unchanged (the gateway then rejects it). The mock gateway settles any
currency, so dev/CI runs the full flow without keys.

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
workspace into a tarball, uploads it with `.env` (including a generated
`JWT_SECRET`), and runs `docker compose up`, so **no git repo or credentials are
needed on the instance**. Migrations run before the API starts. The API is
published at `https://api.<elastic-ip>.nip.io` (free DNS, automatic TLS).
`terraform destroy` tears it down.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm build` | Turbo build of every package |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm test` | Vitest: policy, engine (incl. takeover races), PayPal webhook verify, contracts, and the API end to end |
| `pnpm db:migrate` | Apply Drizzle migrations |
| `pnpm lint` | Prettier check |
| `pnpm docker:up` | `docker compose up -d` |

The API suite (`apps/api/test`) drives the real Fastify app against Postgres and
Redis. It runs when `TEST_DATABASE_URL` and `TEST_REDIS_URL` point at throwaway
instances (CI starts them as services) and is skipped otherwise:

```bash
docker run -d --rm --name moltol-test-pg -e POSTGRES_USER=moltol -e POSTGRES_PASSWORD=moltol -e POSTGRES_DB=moltol_test -p 55432:5432 postgres:16-alpine
docker run -d --rm --name moltol-test-redis -p 56379:6379 redis:7-alpine
TEST_DATABASE_URL=postgres://moltol:moltol@localhost:55432/moltol_test TEST_REDIS_URL=redis://localhost:56379 pnpm test
```

## License

MIT — see [LICENSE](./LICENSE).
