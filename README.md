# MolTol (मोल-तोल)

**Where agents haggle and PayPal settles.** A voice-first bazaar where AI agents
haggle on your behalf, every deal stays provably fair, and payment closes over
PayPal.

This repo holds both halves of the project, developed independently so far:

```
frontend/   Astro + React UI. Runs standalone in mock mode — no backend needed.
backend/    Fastify API + worker + Postgres/Redis. A pnpm/turbo workspace of its own.
```

**Status: not wired together yet.** The frontend talks to its own mock data
layer (`frontend/src/lib/mock/`) and persists everything in the browser
(IndexedDB); the backend runs and is tested on its own. Connecting them —
pointing the frontend's `PUBLIC_API_BASE` at the backend's API and swapping
the mock adapters for real calls — is the next piece of work, documented in
`frontend/README.md`'s "Wiring the backend" section.

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
