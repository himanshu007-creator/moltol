# syntax=docker/dockerfile:1.7
# Build context is the repo root (see docker-compose.yml / Terraform).

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/workflow/package.json apps/workflow/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/llm/package.json packages/llm/package.json
COPY packages/market/package.json packages/market/package.json
COPY packages/paypal/package.json packages/paypal/package.json
COPY packages/policy/package.json packages/policy/package.json
COPY packages/store/package.json packages/store/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @moltol/api... build
RUN pnpm --filter @moltol/api deploy --prod /prod/api

FROM node:22-alpine AS runner
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /prod/api ./
USER app
EXPOSE 3000
CMD ["node", "dist/index.js"]
