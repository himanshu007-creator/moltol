import { createMarketProvider } from "@moltol/market";
import { PayPalClient, captureOrder, createOrder, type PayPalEnv } from "@moltol/paypal";
import { createTurnGenerator } from "@moltol/llm";
import type { TurnGenerator } from "@moltol/engine";
import { createRedis, type Redis } from "./redis";
import { paypalConfigured, type Env } from "./env";
import { createDb, MoltolStore } from "@moltol/store";

export interface CheckoutGateway {
  createCheckout(params: {
    negotiationId: string;
    amountCents: number;
    currency: string;
  }): Promise<{ orderId: string; approveUrl: string | null }>;
  capture(negotiationId: string, orderId: string): Promise<{ captureId: string; status: string }>;
  captures?: boolean;
}

export interface Container {
  env: Env;
  store: MoltolStore;
  redis: Redis;
  market: ReturnType<typeof createMarketProvider>;
  llm: TurnGenerator;
  checkout: CheckoutGateway;
  close: () => Promise<void>;
}

/** Real PayPal via Orders v2. Capture is idempotent via PayPal-Request-Id. */
function realGateway(env: Env): CheckoutGateway {
  const client = new PayPalClient({
    env: env.PAYPAL_ENV as PayPalEnv,
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
  });
  return {
    async createCheckout({ negotiationId, amountCents, currency }) {
      const result = await createOrder(client, {
        amountCents,
        currency,
        referenceId: negotiationId,
        requestId: `${negotiationId}:create`,
        returnUrl: `${env.PUBLIC_BASE_URL}/return`,
        cancelUrl: `${env.PUBLIC_BASE_URL}/cancel`,
      });
      return { orderId: result.orderId, approveUrl: result.approveUrl };
    },
    async capture(negotiationId, orderId) {
      const result = await captureOrder(client, orderId, `${negotiationId}:capture`);
      return { captureId: result.captureId ?? `capture_${orderId}`, status: result.status };
    },
    captures: true,
  };
}

/** Offline gateway so the full flow (checkout -> capture -> webhook) runs in CI/dev. */
function mockGateway(): CheckoutGateway {
  return {
    async createCheckout({ negotiationId }) {
      return { orderId: `MOCK-${negotiationId.slice(0, 8)}`, approveUrl: null };
    },
    async capture(_negotiationId, orderId) {
      return { captureId: `MOCK-CAP-${orderId}`, status: "COMPLETED" };
    },
    captures: false,
  };
}

export function createContainer(env: Env): Container {
  const { sql, db } = createDb(env.DATABASE_URL);
  const store = new MoltolStore(db, sql);
  const redis = createRedis(env.REDIS_URL);
  const market = createMarketProvider({
    channel3ApiKey: env.CHANNEL3_API_KEY || undefined,
  });
  const llm = createTurnGenerator({
    baseUrl: env.LLM_BASE_URL || undefined,
    apiKey: env.LLM_API_KEY || undefined,
    model: env.LLM_MODEL || undefined,
  });
  const checkout = paypalConfigured(env) ? realGateway(env) : mockGateway();
  return {
    env,
    store,
    redis,
    market,
    llm,
    checkout,
    close: async () => {
      await redis.quit().catch(() => {});
      await sql.end({ timeout: 5 }).catch(() => {});
    },
  };
}
