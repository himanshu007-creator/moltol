import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import type { NegotiationRunner } from "@moltol/engine";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { registerAuthenticate } from "./auth";
import { registerAuthRoutes } from "./auth-routes";
import { registerBasketRoutes } from "./basket-routes";
import { createContainer, type Container } from "./container";
import { createQueueRunner } from "./enqueue";
import type { Env } from "./env";
import { sendProblem } from "./http";
import { registerOrderRoutes } from "./order-routes";
import { registerCoreRoutes } from "./routes";
import { registerShopRoutes } from "./shop-routes";

export interface BuiltApp {
  app: FastifyInstance;
  container: Container;
  runner: NegotiationRunner & { close?: () => Promise<void> };
}

/**
 * The whole HTTP surface, without listening — `index.ts` serves it, the
 * integration tests drive it with `inject`. Plugin order matters: rate limits
 * attach to routes as they are registered, so they go first.
 */
export async function buildApp(options: {
  env: Env;
  container?: Container;
  runner?: BuiltApp["runner"];
  logger?: FastifyServerOptions["logger"];
}): Promise<BuiltApp> {
  const { env } = options;
  const serverOptions: FastifyServerOptions = {
    logger: options.logger ?? {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
    },
    trustProxy: env.TRUST_PROXY === "false" || env.TRUST_PROXY === "" ? false : env.TRUST_PROXY,
  };
  const app = Fastify(serverOptions);

  // Keep the raw body so PayPal webhook self-verification can CRC-32 the exact bytes,
  // but parse with Fastify's own secure parser (rejects __proto__/constructor poisoning).
  const secureJson = app.getDefaultJsonParser("error", "error");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as typeof req & { rawBody?: string }).rawBody = body as string;
    if (!body) return done(null, {});
    secureJson(req, body as string, done);
  });

  const container = options.container ?? createContainer(env);
  const runner = options.runner ?? createQueueRunner(env.REDIS_URL);

  await app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_PER_MIN,
    timeWindow: "1 minute",
    // Shared across API replicas; a Redis hiccup must not take the API down with it.
    redis: container.redis,
    nameSpace: "moltol:rl:",
    skipOnError: true,
  });

  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: env.JWT_TTL } });
  registerAuthenticate(app, container);

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status === 429) return sendProblem(reply, 429, "rate_limited", err.message);
    if (status >= 500) {
      req.log.error({ err }, "request failed");
      return sendProblem(reply, status, "internal_error");
    }
    return sendProblem(reply, status, status === 400 ? "invalid_request" : "error", err.message);
  });
  app.setNotFoundHandler((_req, reply) => sendProblem(reply, 404, "not_found"));

  await app.register(import("@fastify/swagger"), {
    openapi: {
      info: {
        title: "MolTol API",
        description: "Agent-to-agent haggling with PayPal settlement",
        version: process.env.IMAGE_TAG ?? "dev",
      },
    },
  });
  await app.register(import("@fastify/swagger-ui"), {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list" },
  });

  await registerCoreRoutes(app, { container, runner });
  await registerAuthRoutes(app, container);
  await registerShopRoutes(app, container);
  await registerBasketRoutes(app, container, runner);
  await registerOrderRoutes(app, container);

  return { app, container, runner };
}
