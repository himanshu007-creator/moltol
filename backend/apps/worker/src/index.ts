import {
  DEFAULT_TURN_DELAY_MS,
  NEGOTIATION_QUEUE,
  NEGOTIATION_TIMEOUT_MS,
  RESERVATION_TTL_MS,
  dealChannel,
  eventChannel,
} from "@moltol/config";
import { dealClosedFromEvent, type NegotiationEvent } from "@moltol/contracts";
import { runHaggle } from "@moltol/engine";
import { createTurnGenerator } from "@moltol/llm";
import { createMarketProvider } from "@moltol/market";
import { createDb, MoltolStore } from "@moltol/store";
import { Worker } from "bullmq";
import { Redis } from "ioredis";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://moltol:moltol@localhost:5432/moltol";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const WORKER_ID = process.env.HOSTNAME ?? `worker-${process.pid}`;
// A paced haggle spends nearly all its time waiting between turns, so many run at once.
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 32);
const TURN_DELAY_MS = Number(process.env.TURN_DELAY_MS ?? DEFAULT_TURN_DELAY_MS);
const HUMAN_TIMEOUT_MS = 30 * 60 * 1000;

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
    serpapiApiKey: process.env.SERPAPI_API_KEY || undefined,
  });
  const llm = createTurnGenerator({
    baseUrl: process.env.LLM_BASE_URL || undefined,
    apiKey: process.env.LLM_API_KEY || undefined,
    model: process.env.LLM_MODEL || undefined,
  });

  const publish = async (event: NegotiationEvent): Promise<void> => {
    await pub.publish(eventChannel(event.negotiationId), JSON.stringify(event));
    // The seller's live feed: an agent-agreed (or timed-out) lane lands here too.
    if (event.t === "deal.agreed" || event.t === "session.ended") {
      const ctx = await store.lineContext(event.negotiationId);
      if (ctx) {
        const frame = dealClosedFromEvent(event, ctx.shopId, ctx.basketId, ctx.name, ctx.currency);
        if (frame) await pub.publish(dealChannel(ctx.shopId), JSON.stringify(frame));
      }
    }
  };

  const worker = new Worker(
    NEGOTIATION_QUEUE,
    async (job) => {
      const negotiationId = (job.data as { negotiationId?: string }).negotiationId;
      if (!negotiationId) return;
      return runHaggle(negotiationId, {
        store,
        llm,
        market,
        onEvent: publish,
        turnDelayMs: TURN_DELAY_MS,
        log: (fields) => log("info", "haggle finished", fields),
      });
    },
    { connection, concurrency: CONCURRENCY },
  );

  worker.on("failed", (job, err) => {
    log("error", "job failed", { negotiationId: job?.data?.negotiationId, error: String(err) });
  });

  // Timeout sweeper: fail negotiations that stalled (including ones never picked up),
  // so demo sessions never hang. The transition and the event commit together.
  const sweep = async (): Promise<void> => {
    const live: ("init" | "committed" | "negotiating")[] = ["init", "committed", "negotiating"];
    // A lane a human took over waits on that human, so it gets longer before it times out.
    const stale = [
      ...(await store.staleNegotiations(new Date(Date.now() - NEGOTIATION_TIMEOUT_MS), live, {
        controlled: false,
      })),
      ...(await store.staleNegotiations(new Date(Date.now() - HUMAN_TIMEOUT_MS), live, {
        controlled: true,
      })),
    ];
    for (const id of stale) {
      const event = await store.appendSystemEvent(
        id,
        { t: "session.ended", reason: "timeout" },
        {
          transition: { from: ["init", "committed", "negotiating"], to: "failed", required: true },
        },
      );
      if (!event) continue;
      await publish(event);
      log("warn", "negotiation timed out", { negotiationId: id });
    }
    // Release stock held by checkouts that were abandoned before capture.
    const released = await store.expireReservations(RESERVATION_TTL_MS);
    if (released > 0) log("info", "expired stock holds", { released });
  };
  const sweeper = setInterval(
    () => void sweep().catch((e) => log("error", "sweep failed", { error: String(e) })),
    30_000,
  );

  log("info", "worker ready", {
    queue: NEGOTIATION_QUEUE,
    concurrency: CONCURRENCY,
    turnDelayMs: TURN_DELAY_MS,
  });

  const shutdown = async (signal: string): Promise<void> => {
    log("info", "shutting down", { signal });
    clearInterval(sweeper);
    await worker.close();
    await pub.quit().catch(() => {});
    await connection.quit().catch(() => {});
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
