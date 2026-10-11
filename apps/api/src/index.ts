import cors from "@fastify/cors";
import Fastify from "fastify";
import { createContainer } from "./container";
import { createQueueRunner } from "./enqueue";
import { loadEnv } from "./env";
import { registerRoutes } from "./routes";

async function main(): Promise<void> {
  const env = loadEnv();

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
    },
  });

  // Keep the raw body so PayPal webhook self-verification can CRC-32 it.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as typeof req & { rawBody?: string }).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error);
    }
  });

  const container = createContainer(env);
  const runner = createQueueRunner(env.REDIS_URL);

  await app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
  });

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
    uiConfig: {
      docExpansion: "list",
    },
  });

  await registerRoutes(app, { container, runner });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await runner.close().catch(() => {});
    await container.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
