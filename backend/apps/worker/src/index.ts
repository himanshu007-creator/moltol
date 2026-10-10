import { Redis } from "ioredis";
import { runStubHaggle } from "./haggle";
import { createDb, loadNegotiation, saveResult } from "./store";

const NEGOTIATION_QUEUE = "moltol:negotiations";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://moltol:moltol@localhost:5432/moltol";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const WORKER_ID = process.env.HOSTNAME ?? `worker-${process.pid}`;

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, workerId: WORKER_ID, ts: new Date().toISOString(), ...extra }));
}

async function main(): Promise<void> {
  const sql = createDb(DATABASE_URL);
  const redis = new Redis(REDIS_URL);
  let running = true;

  const shutdown = async (signal: string): Promise<void> => {
    log("info", "shutting down", { signal });
    running = false;
    await redis.quit().catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  log("info", "worker ready", { queue: NEGOTIATION_QUEUE });

  while (running) {
    const popped = await redis.brpop(NEGOTIATION_QUEUE, 5);
    if (!popped) continue;
    const [, payload] = popped;
    let negotiationId: string | undefined;
    try {
      negotiationId = (JSON.parse(payload) as { negotiationId?: string }).negotiationId;
      if (!negotiationId) {
        log("warn", "task missing negotiationId", { payload });
        continue;
      }
      const negotiation = await loadNegotiation(sql, negotiationId);
      if (!negotiation) {
        log("warn", "negotiation not found", { negotiationId });
        continue;
      }
      const result = runStubHaggle(negotiation);
      await saveResult(sql, negotiationId, result.turns, result.state, result.agreedPriceCents);
      log("info", "negotiation settled", {
        negotiationId,
        state: result.state,
        agreedPriceCents: result.agreedPriceCents,
        turns: result.turns.length,
      });
    } catch (err) {
      log("error", "task failed", { negotiationId, error: String(err) });
      if (negotiationId) await redis.lpush(NEGOTIATION_QUEUE, JSON.stringify({ negotiationId }));
    }
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
