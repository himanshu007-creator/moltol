import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  CheckoutInputSchema,
  CreateNegotiationSchema,
  problem,
  type NegotiationEvent,
} from "@moltol/contracts";
import { eventChannel, SSE_HEARTBEAT_MS } from "@moltol/config";
import type { Redis } from "ioredis";
import type { Container } from "./container";
import type { NegotiationRunner } from "@moltol/engine";
import { revealProof } from "./proof";
import { verifyWebhookSignature } from "@moltol/paypal";

export interface RouteDeps {
  container: Container;
  runner: NegotiationRunner;
}

function sendProblem(reply: FastifyReply, status: number, title: string, detail?: string): void {
  reply
    .code(status)
    .type("application/problem+json")
    .send(problem(status, title, detail));
}

async function publish(redis: Redis, event: NegotiationEvent): Promise<void> {
  await redis.publish(eventChannel(event.negotiationId), JSON.stringify(event));
}

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { container, runner } = deps;
  const { store, redis, env, market, checkout } = container;

  const emit = async (event: NegotiationEvent): Promise<void> => {
    await store.appendEvent(event);
    await publish(redis, event);
  };

  /* --------------------------------- health -------------------------------- */

  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/readyz", async (_req, reply) => {
    const checks: Record<string, boolean> = {};
    try {
      checks.postgres = await store.ping();
    } catch {
      checks.postgres = false;
    }
    try {
      checks.redis = (await redis.ping()) === "PONG";
    } catch {
      checks.redis = false;
    }
    const ready = Object.values(checks).every(Boolean);
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "degraded", checks });
  });

  app.get("/v1/version", async () => ({
    name: "moltol-api",
    version: process.env.IMAGE_TAG ?? "dev",
    uptimeSeconds: Math.round(process.uptime()),
    instance: process.env.HOSTNAME ?? "local",
    paypal: checkout.captures ? "real" : "mock",
  }));

  /* ------------------------------ negotiations ----------------------------- */

  app.post("/v1/negotiations", async (req, reply) => {
    const parsed = CreateNegotiationSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendProblem(reply, 400, "invalid_body", JSON.stringify(parsed.error.flatten()));
    }
    const negotiation = await store.createNegotiation(parsed.data);
    await runner.enqueue(negotiation.id);
    return reply.code(201).send(negotiation);
  });

  app.get<{ Params: { id: string } }>("/v1/negotiations/:id", async (req, reply) => {
    const negotiation = await store.getNegotiation(req.params.id);
    if (!negotiation) return sendProblem(reply, 404, "not_found");
    return negotiation;
  });

  // SSE: backfill from the event log, then stream live events from Redis.
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    "/v1/negotiations/:id/events",
    async (req, reply) => {
      const id = req.params.id;
      const negotiation = await store.getNegotiation(id);
      if (!negotiation) return sendProblem(reply, 404, "not_found");

      const after = req.query.after !== undefined ? Number(req.query.after) : -1;
      let lastSeq = Number.isFinite(after) ? after : -1;
      const client = redis.duplicate();
      await client.subscribe(eventChannel(id));

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.raw.write(`retry: 3000\n\n`);

      const write = (event: NegotiationEvent) => {
        if (event.seq <= lastSeq) return;
        lastSeq = event.seq;
        reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      const backfill = await store.listEvents(id, after);
      for (const event of backfill) write(event);

      const onMessage = (_channel: string, message: string) => {
        try {
          write(JSON.parse(message) as NegotiationEvent);
        } catch {
          /* ignore malformed */
        }
      };
      client.on("message", onMessage);

      const heartbeat = setInterval(() => reply.raw.write(`: heartbeat\n\n`), SSE_HEARTBEAT_MS);

      const cleanup = () => {
        clearInterval(heartbeat);
        client.off("message", onMessage);
        void client.quit().catch(() => {});
      };
      req.raw.on("close", cleanup);
      req.raw.on("error", cleanup);
    },
  );

  app.get<{ Params: { id: string } }>("/v1/negotiations/:id/proof", async (req, reply) => {
    const proof = await revealProof(store, req.params.id, emit);
    if (!proof) return sendProblem(reply, 409, "no_deal_to_prove");
    return proof;
  });

  /* -------------------------------- payments ------------------------------- */

  app.post<{ Params: { id: string } }>("/v1/negotiations/:id/checkout", async (req, reply) => {
    const n = await store.getNegotiation(req.params.id);
    if (!n) return sendProblem(reply, 404, "not_found");
    if (n.agreedPriceCents === null) return sendProblem(reply, 409, "no_agreement");
    CheckoutInputSchema.safeParse(req.body ?? {});

    const existing = await store.getPaymentByNegotiation(n.id);
    if (existing) {
      return {
        negotiationId: n.id,
        paypalOrderId: existing.paypalOrderId,
        approveUrl: null,
        amountCents: existing.amountCents,
        currency: existing.currency,
      };
    }

    const order = await checkout.createCheckout({
      negotiationId: n.id,
      amountCents: n.agreedPriceCents,
      currency: n.currency,
    });
    await store.createPayment({
      negotiationId: n.id,
      paypalOrderId: order.orderId,
      amountCents: n.agreedPriceCents,
      currency: n.currency,
    });
    await store.setPayment(n.id, order.orderId);
    await store.transition(n.id, "agreed", "payment_pending");
    await emit(
      store.makeEvent(n.id, await store.nextSeq(n.id), {
        t: "payment.status",
        status: "order_created",
        paypalOrderId: order.orderId,
      }),
    );
    return reply.code(201).send({
      negotiationId: n.id,
      paypalOrderId: order.orderId,
      approveUrl: order.approveUrl,
      amountCents: n.agreedPriceCents,
      currency: n.currency,
    });
  });

  app.post<{ Params: { id: string } }>("/v1/negotiations/:id/capture", async (req, reply) => {
    const n = await store.getNegotiation(req.params.id);
    if (!n) return sendProblem(reply, 404, "not_found");
    const payment = await store.getPaymentByNegotiation(n.id);
    if (!payment) return sendProblem(reply, 409, "no_checkout");
    if (payment.status === "captured") {
      return { negotiationId: n.id, captureId: payment.paypalCaptureId, status: "captured" };
    }

    const result = await checkout.capture(n.id, payment.paypalOrderId);
    await store.updatePaymentStatus(payment.paypalOrderId, "captured", result.captureId);
    await store.setPayment(n.id, payment.paypalOrderId, result.captureId);
    await store.transition(n.id, "payment_pending", "paid");
    await emit(
      store.makeEvent(n.id, await store.nextSeq(n.id), {
        t: "payment.status",
        status: "captured",
        paypalOrderId: payment.paypalOrderId,
        paypalCaptureId: result.captureId,
      }),
    );
    const proof = await revealProof(store, n.id, emit);
    await store.transition(n.id, "paid", "revealed");
    return { negotiationId: n.id, captureId: result.captureId, status: "captured", proof };
  });

  /* -------------------------------- webhook -------------------------------- */

  app.post("/v1/webhooks/paypal", async (req, reply) => {
    const rawBody = (req.raw as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const verified = await verifyWebhookSignature({
      headers: req.headers as Record<string, string | string[] | undefined>,
      rawBody,
      webhookId: env.PAYPAL_WEBHOOK_ID || "WEBHOOK_ID",
      env: env.PAYPAL_ENV,
    });
    if (!verified) return sendProblem(reply, 401, "invalid_webhook_signature");

    const body = req.body as {
      id?: string;
      event_type?: string;
      resource?: { id?: string; supplementary_data?: { related_ids?: { order_id?: string } } };
    };
    const eventId = body.id ?? randomUUID();
    const isNew = await store.recordWebhook(
      eventId,
      body.event_type ?? "unknown",
      body as Record<string, unknown>,
    );
    if (!isNew) return reply.code(200).send({ ok: true, duplicate: true });

    const orderId =
      body.resource?.supplementary_data?.related_ids?.order_id ??
      (body.resource?.id?.startsWith("MOCK") ? body.resource.id : undefined);

    if (body.event_type === "PAYMENT.CAPTURE.COMPLETED" && orderId) {
      const payment = await store.getPaymentByOrder(orderId);
      if (payment && payment.status !== "captured") {
        await store.updatePaymentStatus(orderId, "captured", body.resource?.id);
        await store.setPayment(payment.negotiationId, orderId, body.resource?.id);
        await store.transition(payment.negotiationId, "payment_pending", "paid");
        await emit(
          store.makeEvent(payment.negotiationId, await store.nextSeq(payment.negotiationId), {
            t: "payment.status",
            status: "captured",
            paypalOrderId: orderId,
            ...(body.resource?.id ? { paypalCaptureId: body.resource.id } : {}),
          }),
        );
        await revealProof(store, payment.negotiationId, emit);
        await store.transition(payment.negotiationId, "paid", "revealed");
      }
    }
    return reply.code(200).send({ ok: true });
  });

  /* --------------------------------- market -------------------------------- */

  app.get<{ Querystring: { query?: string; currency?: string } }>(
    "/v1/market/comps",
    async (req, reply) => {
      const query = req.query.query ?? "water bottle";
      const currency = (req.query.currency ?? "USD").toUpperCase();
      return market.getComps(query, currency);
    },
  );
}
