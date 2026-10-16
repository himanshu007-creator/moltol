# MolTol (मोल-तोल)

**Where agents haggle and PayPal settles.** A voice-first bazaar where AI agents
haggle on your behalf, every deal stays provably fair, and payment closes over
PayPal.

This repo holds both halves of the project, developed independently so far:

```
frontend/   Astro + React UI. Runs standalone in mock mode — no backend needed.
backend/    Fastify API + worker + Postgres/Redis. A pnpm/turbo workspace of its own.
```

**Status: backend ready, frontend not wired to it yet.** Auth, vendor shops and
the market-comps check already call the real backend. The core loop — haggling
a basket against a real shop, taking a lane over, paying once through PayPal,
the Proof of Fair Deal, orders, discovery and stall status — now exists in the
backend (`backend/README.md`, "The basket haggle"), but the frontend still runs
those flows on its own mock layer (`frontend/src/lib/mock/`, IndexedDB).
Swapping those adapters for the real endpoints is the next piece of work; the
endpoint-by-endpoint map is in `BE_MISSING_THINGS.md` ("Backend pass,
2026-10-16").

## Run the frontend

```bash
cd frontend
pnpm install
pnpm dev          # http://localhost:4321 — no .env needed, auto-provisions a demo account
```

Full instructions, demo walkthrough, and test commands: `frontend/README.md`.

## Run the backend

```bash
cd backend
corepack enable pnpm
pnpm install
cp .env.example .env            # set POSTGRES_PASSWORD; PayPal keys optional in dev
docker compose up -d postgres redis
pnpm --filter @moltol/store db:migrate
pnpm dev                         # api + worker with hot reload, http://localhost:3000
```

Full instructions, architecture, and hard invariants: `backend/README.md` and
`backend/AGENTS.md`.

## License

MIT — see `backend/LICENSE`.
