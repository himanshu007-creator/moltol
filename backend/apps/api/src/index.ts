import cors from "@fastify/cors";
import Fastify from "fastify";
import { createDb } from "./db";
import { loadEnv } from "./env";
import { createRedis } from "./redis";
import { registerRoutes } from "./routes";
import { NegotiationStore } from "./store";

async function main(): Promise<void> {
  const env = loadEnv();

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
    },
  });

  const sql = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  const store = new NegotiationStore(sql);

  await store.ensureSchema();

  await app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
  });
  await registerRoutes(app, { sql, redis, store });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await redis.quit().catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
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
