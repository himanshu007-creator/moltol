import { NEGOTIATION_QUEUE, NEGOTIATION_TIMEOUT_MS, eventChannel } from "@moltol/config";
import type { NegotiationEvent } from "@moltol/contracts";
import { runHaggle } from "@moltol/engine";
import { createTurnGenerator } from "@moltol/llm";
import { createMarketProvider } from "@moltol/market";
import { createDb, MoltolStore } from "@moltol/store";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://moltol:moltol@localhost:5432/moltol";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const WORKER_ID = process.env.HOSTNAME ?? `worker-${process.pid}`;
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({ level, msg, workerId: WORKER_ID, ts: new Date().toISOString(), ...extra }),
  );
}

async function main(): Promise<void> {
  const { sql, db } = createDb(DATABASE_URL);
  const store = new MoltolStore(db, sql);
  const pub = new Redis(REDIS_URL);
  const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const market = createMarketProvider({
    channel3ApiKey: process.env.CHANNEL3_API_KEY || undefined,
  });
  const llm = createTurnGenerator({
    baseUrl: process.env.LLM_BASE_URL || undefined,
    apiKey: process.env.LLM_API_KEY || undefined,
    model: process.env.LLM_MODEL || undefined,
  });

  const publish = async (event: NegotiationEvent): Promise<void> => {
    await pub.publish(eventChannel(event.negotiationId), JSON.stringify(event));
  };

  const worker = new Worker(
    NEGOTIATION_QUEUE,
    async (job) => {
      const negotiationId = (job.data as { negotiationId?: string }).negotiationId;
      if (!negotiationId) return;
      const outcome = await runHaggle(negotiationId, {
        store,
        llm,
        market,
        onEvent: publish,
        log: (fields) => log("info", "haggle finished", fields),
      });
      return outcome;
    },
    { connection, concurrency: CONCURRENCY },
  );

  worker.on("failed", (job, err) => {
    log("error", "job failed", { negotiationId: job?.data?.negotiationId, error: String(err) });
  });

  // Timeout sweeper: fail negotiations that stalled, so demo sessions never hang.
  const queue = new Queue(NEGOTIATION_QUEUE, { connection });
  const sweep = async (): Promise<void> => {
    const cutoff = new Date(Date.now() - NEGOTIATION_TIMEOUT_MS);
    const stale = await store.staleNegotiations(cutoff, ["committed", "negotiating"]);
    for (const id of stale) {
      await store.transition(id, "negotiating", "failed");
      await store.transition(id, "committed", "failed");
      const event = store.makeEvent(id, await store.nextSeq(id), {
        t: "session.ended",
        reason: "timeout",
      });
      await store.appendEvent(event);
      await publish(event);
      log("warn", "negotiation timed out", { negotiationId: id });
    }
  };
  const sweeper = setInterval(
    () => void sweep().catch((e) => log("error", "sweep failed", { error: String(e) })),
    30_000,
  );

  log("info", "worker ready", { queue: NEGOTIATION_QUEUE, concurrency: CONCURRENCY });

  const shutdown = async (signal: string): Promise<void> => {
    log("info", "shutting down", { signal });
    clearInterval(sweeper);
    await worker.close();
    await queue.close();
    await pub.quit().catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
