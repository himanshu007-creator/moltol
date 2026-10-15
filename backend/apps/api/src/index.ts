import { buildApp } from "./app";
import { loadEnv } from "./env";

async function main(): Promise<void> {
  const env = loadEnv();
  const { app, container, runner } = await buildApp({ env });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await runner.close?.().catch(() => {});
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
