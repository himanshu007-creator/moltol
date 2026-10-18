import type { FastifyInstance } from "fastify";
import { CreateNegotiationSchema } from "@moltol/contracts";
import type { NegotiationRunner } from "@moltol/engine";
import { PayPalApiError, SIMULATOR_WEBHOOK_ID, verifyWebhookSignature } from "@moltol/paypal";
import { createCheckoutForDeal } from "./checkout";
import type { Container } from "./container";
import { invalidBody, isUuid, sendKnownError, sendProblem } from "./http";
import { applyCapture, approveAndCapture, refundPayment, settleCapture } from "./payments";
import { revealProof } from "./proof";
import { resumeSeqs, streamNegotiations } from "./sse";
import { paymentQuote } from "./views";

export interface RouteDeps {
  container: Container;
  runner: NegotiationRunner;
}

interface PayPalWebhookBody {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
}

/**
 * Health, the standalone agent-vs-agent negotiation (the original demo: one
 * query, a market-derived shop), the PayPal webhook, and market comps. Baskets,
 * shops, auth and orders register their own routes.
 */
export async function registerCoreRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { container, runner } = deps;
  const { store, redis, env, market, checkout } = container;

  /* --------------------------------- health -------------------------------- */

  app.get("/healthz", { config: { rateLimit: false } }, async () => ({ status: "ok" }));

  app.get("/readyz", { config: { rateLimit: false } }, async (_req, reply) => {
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

  /* ------------------------ standalone negotiations ------------------------ */

  app.post(
    "/v1/negotiations",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = CreateNegotiationSchema.safeParse(req.body);
      if (!parsed.success) return invalidBody(reply, parsed.error);
      const negotiation = await store.createNegotiation(parsed.data);
      await runner.enqueue(negotiation.id);
      return reply.code(201).send(negotiation);
    },
  );

  app.get<{ Params: { id: string } }>("/v1/negotiations/:id", async (req, reply) => {
    if (!isUuid(req.params.id)) return sendProblem(reply, 404, "not_found");
    const negotiation = await store.getNegotiation(req.params.id);
    if (!negotiation) return sendProblem(reply, 404, "not_found");
    return negotiation;
  });

  // SSE: backfill from the event log, then stream live events from Redis.
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    "/v1/negotiations/:id/events",
    { exposeHeadRoute: false },
    async (req, reply) => {
      const id = req.params.id;
      if (!isUuid(id) || !(await store.getNegotiation(id))) {
        return sendProblem(reply, 404, "not_found");
      }
      const [afterSeq] = resumeSeqs(req, 1);
      await streamNegotiations(
        req,
        reply,
        { redis, store },
        [{ negotiationId: id, afterSeq: afterSeq! }],
        (s) => String(s[0]),
      );
    },
  );

  app.get<{ Params: { id: string } }>("/v1/negotiations/:id/proof", async (req, reply) => {
    if (!isUuid(req.params.id)) return sendProblem(reply, 404, "not_found");
    const proof = await revealProof(store, req.params.id, container.publish);
    if (!proof) {
      return sendProblem(reply, 409, "not_settled", "The proof is revealed once the deal is paid.");
    }
    return proof;
  });

  /* -------------------------------- payments ------------------------------- */

  app.post<{ Params: { id: string } }>("/v1/negotiations/:id/checkout", async (req, reply) => {
    if (!isUuid(req.params.id)) return sendProblem(reply, 404, "not_found");
    const n = await store.getNegotiation(req.params.id);
    if (!n) return sendProblem(reply, 404, "not_found");
    if (n.basketId)
      return sendProblem(reply, 409, "basket_line", "Check out the whole basket instead.");
    if (n.agreedPriceCents === null) return sendProblem(reply, 409, "no_agreement");

    const existing = await store.getPaymentByNegotiation(n.id);
    if (existing) {
      return { negotiationId: n.id, ...paymentQuote(existing) };
    }

    let quote: Awaited<ReturnType<typeof createCheckoutForDeal>>;
    try {
      quote = await createCheckoutForDeal(container, {
        referenceId: n.id,
        amountCents: n.agreedPriceCents,
        currency: n.currency,
      });
    } catch (err) {
      return sendKnownError(reply, err);
    }
    const { order, charged } = quote;
    await store.createPayment({
      negotiationId: n.id,
      paypalOrderId: order.orderId,
      approveUrl: order.approveUrl,
      amountCents: charged.amountCents,
      currency: charged.currency,
      dealAmountCents: n.agreedPriceCents,
      dealCurrency: n.currency,
      fxRate: charged.fxRate,
    });
    await store.setPayment(n.id, order.orderId);
    const event = await store.appendSystemEvent(
      n.id,
      { t: "payment.status", status: "order_created", paypalOrderId: order.orderId },
      { transition: { from: ["agreed"], to: "payment_pending", required: true } },
    );
    if (event) await container.publish(event);
    return reply.code(201).send({
      negotiationId: n.id,
      paypalOrderId: order.orderId,
      approveUrl: order.approveUrl,
      amountCents: charged.amountCents,
      currency: charged.currency,
      deal: { amountCents: n.agreedPriceCents, currency: n.currency },
      fxRate: charged.fxRate,
    });
  });

  app.post<{ Params: { id: string } }>("/v1/negotiations/:id/capture", async (req, reply) => {
    if (!isUuid(req.params.id)) return sendProblem(reply, 404, "not_found");
    const n = await store.getNegotiation(req.params.id);
    if (!n) return sendProblem(reply, 404, "not_found");
    const payment = await store.getPaymentByNegotiation(n.id);
    if (!payment) return sendProblem(reply, 409, "no_checkout");
    if (payment.status === "failed" || payment.status === "refunded") {
      return sendProblem(reply, 409, `payment_${payment.status}`);
    }

    if (payment.status === "captured") {
      const [proof] = await settleCapture(container, payment, payment.paypalCaptureId);
      return {
        negotiationId: n.id,
        captureId: payment.paypalCaptureId,
        status: "captured",
        proof: proof ?? null,
      };
    }
    let capture: { captureId: string; status: string };
    try {
      capture = await checkout.capture(n.id, payment.paypalOrderId);
    } catch (err) {
      return sendKnownError(reply, err);
    }
    const result = await applyCapture(container, payment, capture);
    if (result.outcome === "failed") return sendProblem(reply, 409, "payment_failed");
    return reply.code(result.outcome === "pending" ? 202 : 200).send({
      negotiationId: n.id,
      captureId: capture.captureId,
      status: result.outcome,
      proof: result.proofs[0] ?? null,
    });
  });

  /* -------------------------------- webhook -------------------------------- */

  app.post("/v1/webhooks/paypal", async (req, reply) => {
    const rawBody = (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    // Without a configured listener id only simulator events (signed with WEBHOOK_ID) can verify.
    const verified = await verifyWebhookSignature({
      headers: req.headers as Record<string, string | string[] | undefined>,
      rawBody,
      webhookId: env.PAYPAL_WEBHOOK_ID || SIMULATOR_WEBHOOK_ID,
      env: env.PAYPAL_ENV,
    });
    if (!verified) return sendProblem(reply, 401, "invalid_webhook_signature");

    const body = (req.body ?? {}) as PayPalWebhookBody;
    if (!body.id) return sendProblem(reply, 400, "missing_event_id");
    const isNew = await store.recordWebhook(
      body.id,
      body.event_type ?? "unknown",
      body as Record<string, unknown>,
    );
    if (!isNew) return reply.code(200).send({ ok: true, duplicate: true });

    try {
      const type = body.event_type;
      const orderId =
        type === "CHECKOUT.ORDER.APPROVED"
          ? body.resource?.id
          : body.resource?.supplementary_data?.related_ids?.order_id;
      const payment = orderId ? await store.getPaymentByOrder(orderId) : null;
      // The event only says WHICH order to look at. What happened is asked of PayPal
      // (an idempotent capture answers with the capture's real status), so a forged
      // or replayed body can't settle anything: with no real PayPal there is nothing to do.
      if (payment && checkout.captures) {
        if (
          type === "CHECKOUT.ORDER.APPROVED" ||
          type === "PAYMENT.CAPTURE.COMPLETED" ||
          type === "PAYMENT.CAPTURE.DENIED"
        ) {
          await approveAndCapture(container, payment).catch((err: unknown) => {
            if (!(err instanceof PayPalApiError)) throw err; // e.g. not approved yet: nothing to settle
          });
        } else if (type === "PAYMENT.CAPTURE.REFUNDED") await refundPayment(container, payment);
      }
    } catch (err) {
      // Let PayPal's retry be processed instead of being dropped as a duplicate.
      await store.forgetWebhook(body.id);
      throw err;
    }
    return reply.code(200).send({ ok: true });
  });

  /* --------------------------------- market -------------------------------- */

  app.get<{ Querystring: { query?: string; currency?: string } }>(
    "/v1/market/comps",
    async (req, reply) => {
      const query = (req.query.query ?? "water bottle").slice(0, 200);
      const currency = (req.query.currency ?? "INR").toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) return sendProblem(reply, 400, "invalid_currency");
      return market.getComps(query, currency);
    },
  );
}
