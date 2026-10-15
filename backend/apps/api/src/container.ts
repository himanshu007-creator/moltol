import { eventChannel } from "@moltol/config";
import type { NegotiationEvent } from "@moltol/contracts";
import type { EngineDeps, TurnGenerator } from "@moltol/engine";
import { createTurnGenerator } from "@moltol/llm";
import { createMarketProvider } from "@moltol/market";
import { PayPalClient, captureOrder, createOrder, type PayPalEnv } from "@moltol/paypal";
import { createDb, MoltolStore } from "@moltol/store";
import { paypalConfigured, type Env } from "./env";
import { createRedis, type Redis } from "./redis";

/**
 * One PayPal order per reference: a standalone negotiation or a whole basket.
 * Create and capture carry stable PayPal-Request-Ids derived from the
 * reference, so a retry can never create or capture twice.
 */
export interface CheckoutGateway {
  createCheckout(params: {
    referenceId: string;
    amountCents: number;
    currency: string;
  }): Promise<{ orderId: string; approveUrl: string | null }>;
  capture(referenceId: string, orderId: string): Promise<{ captureId: string; status: string }>;
  /** true = real PayPal (the buyer must approve before capture). */
  captures?: boolean;
}

export interface Container {
  env: Env;
  store: MoltolStore;
  redis: Redis;
  market: ReturnType<typeof createMarketProvider>;
  llm: TurnGenerator;
  checkout: CheckoutGateway;
  /** Fan an event out to live SSE subscribers (after it was committed to the log). */
  publish: (event: NegotiationEvent) => Promise<void>;
  /** Engine dependencies for human-driven steps; events are published as they commit. */
  engine: () => EngineDeps;
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
    async createCheckout({ referenceId, amountCents, currency }) {
      const result = await createOrder(client, {
        amountCents,
        currency,
        referenceId,
        requestId: `${referenceId}:create`,
        returnUrl: `${env.PUBLIC_BASE_URL}/return`,
        cancelUrl: `${env.PUBLIC_BASE_URL}/cancel`,
      });
      return { orderId: result.orderId, approveUrl: result.approveUrl };
    },
    async capture(referenceId, orderId) {
      const result = await captureOrder(client, orderId, `${referenceId}:capture`);
      // The capture's own status (COMPLETED / PENDING / DECLINED), not the order's.
      return {
        captureId: result.captureId ?? `capture_${orderId}`,
        status: result.captureStatus ?? result.status,
      };
    },
    captures: true,
  };
}

/** Offline gateway so the full flow (checkout -> capture) runs in CI/dev without PayPal keys. */
export function mockGateway(): CheckoutGateway {
  return {
    async createCheckout({ referenceId }) {
      return { orderId: `MOCK-${referenceId}`, approveUrl: null };
    },
    async capture(_referenceId, orderId) {
      return { captureId: `MOCK-CAP-${orderId}`, status: "COMPLETED" };
    },
    captures: false,
  };
}

export function createContainer(
  env: Env,
  overrides: Partial<Pick<Container, "checkout" | "llm" | "market">> = {},
): Container {
  const { sql, db } = createDb(env.DATABASE_URL);
  const store = new MoltolStore(db, sql);
  const redis = createRedis(env.REDIS_URL);
  const market =
    overrides.market ??
    createMarketProvider({
      channel3ApiKey: env.CHANNEL3_API_KEY || undefined,
    });
  const llm =
    overrides.llm ??
    createTurnGenerator({
      baseUrl: env.LLM_BASE_URL || undefined,
      apiKey: env.LLM_API_KEY || undefined,
      model: env.LLM_MODEL || undefined,
    });
  const checkout = overrides.checkout ?? (paypalConfigured(env) ? realGateway(env) : mockGateway());
  const publish = async (event: NegotiationEvent): Promise<void> => {
    await redis.publish(eventChannel(event.negotiationId), JSON.stringify(event));
  };
  return {
    env,
    store,
    redis,
    market,
    llm,
    checkout,
    publish,
    engine: () => ({ store, llm, market, onEvent: publish }),
    close: async () => {
      await redis.quit().catch(() => {});
      await sql.end({ timeout: 5 }).catch(() => {});
    },
  };
}
