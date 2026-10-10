import type { FastifyInstance } from "fastify";
import { CreateNegotiationSchema } from "@moltol/contracts";
import type { Redis } from "ioredis";
import type { Sql } from "./db";
import type { NegotiationStore } from "./store";

export interface RouteDeps {
  sql: Sql;
  redis: Redis;
  store: NegotiationStore;
}

export const NEGOTIATION_QUEUE = "moltol:negotiations";

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { sql, redis, store } = deps;

  // Liveness: the process is up. No dependencies checked.
  app.get("/healthz", async () => ({ status: "ok" }));

  // Readiness: dependencies are reachable.
  app.get("/readyz", async (_req, reply) => {
    const checks: Record<string, boolean> = {};
    try {
      await sql`SELECT 1`;
      checks.postgres = true;
    } catch {
      checks.postgres = false;
    }
    try {
      checks.redis = (await redis.ping()) === "PONG";
    } catch {
      checks.redis = false;
    }
    const ready = Object.values(checks).every(Boolean);
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "degraded", checks });
  });

  app.get("/v1/version", async () => ({
    name: "moltol-api",
    version: process.env.IMAGE_TAG ?? "dev",
    uptimeSeconds: Math.round(process.uptime()),
    instance: process.env.HOSTNAME ?? "local",
  }));

  // Start a haggle. Contract-first: validated with the shared zod schema.
  app.post("/v1/negotiations", async (req, reply) => {
    const parsed = CreateNegotiationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const negotiation = await store.create(parsed.data);
    // Hand off to a worker. Real negotiation logic lands in the worker app.
    await redis.lpush(NEGOTIATION_QUEUE, JSON.stringify({ negotiationId: negotiation.id }));
    return reply.code(201).send(negotiation);
  });

  app.get<{ Params: { id: string } }>("/v1/negotiations/:id", async (req, reply) => {
    const negotiation = await store.get(req.params.id);
    if (!negotiation) return reply.code(404).send({ error: "not_found" });
    return negotiation;
  });
}
