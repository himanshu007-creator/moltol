import { eventChannel } from "@moltol/config";
import type { NegotiationEvent } from "@moltol/contracts";
import type { MarketProvider, TurnGenerator } from "@moltol/engine";
import { createTurnGenerator } from "@moltol/llm";
import { createMarketProvider } from "@moltol/market";
import { createDb, MoltolStore } from "@moltol/store";
import { Redis } from "ioredis";

/**
 * Render Workflows task runs are short-lived and may be reused; build the
 * database/Redis clients once per instance and share them across runs.
 */
export interface WorkflowContext {
  store: MoltolStore;
  market: MarketProvider;
  llm: TurnGenerator;
  publish: (event: NegotiationEvent) => Promise<void>;
}

let cached: WorkflowContext | null = null;

export function getContext(): WorkflowContext {
  if (cached) return cached;
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://moltol:moltol@localhost:5432/moltol";
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const { sql, db } = createDb(databaseUrl);
  const store = new MoltolStore(db, sql);
  const redis = new Redis(redisUrl);
  const market = createMarketProvider({
    channel3ApiKey: process.env.CHANNEL3_API_KEY || undefined,
  });
  const llm = createTurnGenerator({
    baseUrl: process.env.LLM_BASE_URL || undefined,
    apiKey: process.env.LLM_API_KEY || undefined,
    model: process.env.LLM_MODEL || undefined,
  });
  cached = {
    store,
    market,
    llm,
    publish: async (event) => {
      await redis.publish(eventChannel(event.negotiationId), JSON.stringify(event));
    },
  };
  return cached;
}
