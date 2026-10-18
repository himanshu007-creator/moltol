import { randomInt, randomUUID } from "node:crypto";
import { dealChannel, PRICE_ROUNDING_CENTS } from "@moltol/config";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  CreateBasketSchema,
  LineOfferSchema,
  allowsFraction,
  isValidQty,
  lineCents,
  roundQty,
  type DealFeedEvent,
  type HaggleTone,
  type Persona,
  type Side,
} from "@moltol/contracts";
import {
  EngineError,
  humanAccept,
  humanOffer,
  takeOver,
  type HumanResult,
  type NegotiationRunner,
} from "@moltol/engine";
import { commit, newSalt, toHex } from "@moltol/policy";
import type { BasketRow, NewBasketLine, SealedRecord } from "@moltol/store";
import { createCheckoutForDeal } from "./checkout";
import type { Container } from "./container";
import { invalidBody, isUuid, sendKnownError, sendProblem } from "./http";
import { applyCapture, settleCapture } from "./payments";
import { revealProof } from "./proof";
import { resumeSeqs, streamNegotiations } from "./sse";
import { basketView, hasDeal, isTerminal, lineView, paymentQuote, shopStatus } from "./views";

/** How fast the buyer's agent concedes, from the tone the buyer picked. */
const TONE_PERSONA: Record<HaggleTone, Persona> = {
  polite: "charmer", // concedes early: the quick, friendly deal
  playful: "storyteller",
  firm: "stoic", // holds late: the hard bargain
};

/** How far above the vendor's floor a line's sealed reserve may land, as a share of the list–floor gap. */
const RESERVE_SPREAD = 0.3;

/**
 * The shop's sealed limit for ONE line: a reserve drawn at random in
 * [floor + one unit, floor + 30% of the gap] (capped at the list price). The
 * shop concedes toward it and the proof reveals it — so neither the counters
 * (whose curve is public) nor the post-payment reveal ever expose the vendor's
 * standing floor, and the vendor never sells below it.
 */
function lineReserve(floorCents: number, listCents: number): number {
  const gap = listCents - floorCents;
  if (gap <= 0) return listCents;
  const jitter = Math.round((randomInt(0, 1_000_001) / 1_000_000) * RESERVE_SPREAD * gap);
  const lift = gap >= 2 * PRICE_ROUNDING_CENTS ? PRICE_ROUNDING_CENTS : 0;
  return Math.min(listCents, floorCents + Math.max(lift, jitter));
}

function seal(
  negotiationId: string,
  side: Side,
  currency: string,
  limitCents: number,
  domainCents: number | null,
): SealedRecord {
  const salt = newSalt(16);
  return {
    negotiationId,
    side,
    commitment: commit({ negotiationId, side, currency, limitCents }, salt),
    limitCents,
    saltHex: toHex(salt),
    domainCents,
  };
}

type BasketParams = { Params: { id: string } };
type LineParams = { Params: { id: string; lineId: string } };

export async function registerBasketRoutes(
  app: FastifyInstance,
  container: Container,
  runner: NegotiationRunner,
): Promise<void> {
  const { store, redis, checkout } = container;
  const auth = { preHandler: [app.authenticate] };

  /** The caller's own basket, or a 404 (someone else's basket is indistinguishable from none). */
  const ownBasket = async (
    req: FastifyRequest<BasketParams>,
    reply: FastifyReply,
  ): Promise<BasketRow | null> => {
    const basket = isUuid(req.params.id) ? await store.getBasket(req.params.id) : null;
    if (!basket || basket.buyerUserId !== req.user.sub) {
      sendProblem(reply, 404, "not_found");
      return null;
    }
    return basket;
  };

  const view = async (basket: BasketRow) => {
    const [shop, lines, payment] = await Promise.all([
      store.getShopById(basket.shopId),
      store.listBasketLines(basket.id),
      store.getPaymentByBasket(basket.id),
    ]);
    return basketView(basket, shop, lines, payment);
  };

  /* --------------------------------- create -------------------------------- */

  app.post(
    "/v1/baskets",
    {
      ...auth,
      config: {
        // Every line is an LLM-narrated haggle: cap baskets per buyer, not per IP.
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
          hook: "preHandler",
          keyGenerator: (req: FastifyRequest) => `user:${req.user?.sub ?? req.ip}`,
        },
      },
    },
    async (req, reply) => {
      const parsed = CreateBasketSchema.safeParse(req.body);
      if (!parsed.success) return invalidBody(reply, parsed.error);
      const { shopId, lines: wanted, request } = parsed.data;

      const shop = await store.getShopById(shopId);
      if (!shop) return sendProblem(reply, 404, "shop_not_found");
      if (!shopStatus(shop).open) {
        return sendProblem(reply, 409, "shop_closed", "This stall is closed right now.");
      }

      const items = new Map(
        (await store.getShopItems(wanted.map((l) => l.itemId))).map((i) => [i.id, i]),
      );
      const lines: NewBasketLine[] = [];
      for (const want of wanted) {
        const item = items.get(want.itemId);
        if (!item || item.shopId !== shop.id) {
          return sendProblem(reply, 422, "unknown_item", `Item ${want.itemId} is not sold here.`);
        }
        if (!isValidQty(want.qty, item.unit)) {
          const rule = allowsFraction(item.unit) ? "at most 3 decimals" : "whole units";
          return sendProblem(reply, 422, "invalid_qty", `${item.name}: ${rule} only.`);
        }
        if (item.quantity !== null && want.qty > item.quantity) {
          return sendProblem(
            reply,
            409,
            "insufficient_stock",
            `Only ${item.quantity} of ${item.name} left.`,
          );
        }
        if (lineCents(item.sellCents, want.qty) < PRICE_ROUNDING_CENTS) {
          return sendProblem(
            reply,
            422,
            "line_too_small",
            `${item.name}: buy at least one whole unit's worth.`,
          );
        }
        if (item.floorCents > item.sellCents) {
          return sendProblem(
            reply,
            409,
            "item_unavailable",
            `${item.name} cannot be haggled right now.`,
          );
        }
        const id = randomUUID();
        lines.push({
          id,
          shopItemId: item.id,
          name: item.name,
          emoji: item.emoji,
          unit: item.unit,
          qty: roundQty(want.qty),
          openCents: item.sellCents,
          // Nobody haggles up from the sticker: the buyer's ceiling is the list price.
          maxCents: item.sellCents,
          floorCents: item.floorCents,
          sealed: [
            seal(id, "buyer", shop.currency, item.sellCents, null),
            seal(
              id,
              "shop",
              shop.currency,
              lineReserve(item.floorCents, item.sellCents),
              item.sellCents,
            ),
          ],
        });
      }

      const { basketId } = await store.createBasket({
        buyerUserId: req.user.sub,
        shopId: shop.id,
        currency: shop.currency,
        roundsMax: request.rounds,
        tone: request.tone,
        preset: request.preset ?? null,
        buyerPersona: TONE_PERSONA[request.tone],
        shopPersona: shop.persona as Persona,
        lines,
      });
      // Tell the vendor's dashboard a new offer just landed (their private feed).
      const incoming: DealFeedEvent = {
        t: "deal.incoming",
        shopId: shop.id,
        basketId,
        ts: new Date().toISOString(),
        currency: shop.currency,
        totalCents: lines.reduce((sum, l) => sum + lineCents(l.openCents, l.qty), 0),
        lines: lines.map((l) => ({
          name: l.name,
          qty: l.qty,
          unit: l.unit,
          listCents: l.openCents,
        })),
      };
      await redis.publish(dealChannel(shop.id), JSON.stringify(incoming));

      for (const line of lines) await runner.enqueue(line.id);
      return reply.code(201).send(await view((await store.getBasket(basketId))!));
    },
  );

  /* ---------------------------------- read --------------------------------- */

  app.get<BasketParams>("/v1/baskets/:id", auth, async (req, reply) => {
    const basket = await ownBasket(req, reply);
    if (!basket) return reply;
    return reply.send(await view(basket));
  });

  /**
   * Every lane's public events on one stream. The basket id is the capability
   * (an EventSource can't send an Authorization header); only `audience: all`
   * events are ever sent. `id:` is each lane's last seq, dot-joined in line
   * order, and comes back as Last-Event-ID on reconnect.
   */
  app.get<BasketParams & { Querystring: { after?: string } }>(
    "/v1/baskets/:id/events",
    { exposeHeadRoute: false },
    async (req, reply) => {
      const basket = isUuid(req.params.id) ? await store.getBasket(req.params.id) : null;
      if (!basket) return sendProblem(reply, 404, "not_found");
      const lines = await store.listBasketLines(basket.id);
      const after = resumeSeqs(req, lines.length);
      await streamNegotiations(
        req,
        reply,
        { redis, store },
        lines.map((line, i) => ({ negotiationId: line.id, afterSeq: after[i]! })),
        (seqs) => seqs.join("."),
      );
    },
  );

  /* ------------------------------ lane control ----------------------------- */

  const laneAction = async (
    req: FastifyRequest<LineParams>,
    reply: FastifyReply,
    act: (lineId: string) => Promise<HumanResult>,
  ) => {
    const basket = await ownBasket(req, reply);
    if (!basket) return reply;
    if (basket.state !== "open") {
      return sendProblem(reply, 409, "checkout_started", "Prices are locked once checkout starts.");
    }
    const line = isUuid(req.params.lineId) ? await store.getNegotiation(req.params.lineId) : null;
    if (!line || line.basketId !== basket.id) return sendProblem(reply, 404, "not_found");
    try {
      const result = await act(line.id);
      return reply.send({
        line: lineView(result.negotiation),
        accepted: result.accepted,
        counterCents: result.counterCents,
      });
    } catch (err) {
      return sendKnownError(reply, err);
    }
  };

  app.post<LineParams>("/v1/baskets/:id/lines/:lineId/takeover", auth, (req, reply) =>
    laneAction(req, reply, (id) => takeOver(id, container.engine())),
  );

  app.post<LineParams>("/v1/baskets/:id/lines/:lineId/offer", auth, async (req, reply) => {
    const parsed = LineOfferSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(reply, parsed.error);
    return laneAction(req, reply, (id) =>
      humanOffer(id, parsed.data.priceCents, container.engine()),
    );
  });

  app.post<LineParams>("/v1/baskets/:id/lines/:lineId/accept", auth, (req, reply) =>
    laneAction(req, reply, (id) => humanAccept(id, container.engine())),
  );

  /** Settle every lane still haggling at the shop's current ask. */
  app.post<BasketParams>("/v1/baskets/:id/accept-all", auth, async (req, reply) => {
    const basket = await ownBasket(req, reply);
    if (!basket) return reply;
    if (basket.state !== "open") {
      return sendProblem(reply, 409, "checkout_started", "Prices are locked once checkout starts.");
    }
    for (const line of await store.listBasketLines(basket.id)) {
      if (isTerminal(line)) continue;
      try {
        await humanAccept(line.id, container.engine());
      } catch (err) {
        // A lane that closed on its own meanwhile is fine; anything else is a real failure.
        if (!(err instanceof EngineError && err.code === "ended"))
          return sendKnownError(reply, err);
      }
    }
    const fresh = await view(basket);
    return reply.send({
      agreed: fresh.lines
        .filter((l) => l.agreedUnitCents !== null)
        .map((l) => ({
          lineItemId: l.lineItemId,
          unitCents: l.agreedUnitCents!,
          lineCents: l.agreedLineCents!,
        })),
      basket: fresh,
    });
  });

  /* ------------------------------- settlement ------------------------------ */

  /** Lock prices for checkout: basket -> payment_pending, each closed line too. Idempotent. */
  const lockForPayment = async (basketId: string, orderId: string) => {
    await store.transitionBasket(basketId, ["open"], "payment_pending");
    for (const line of (await store.listBasketLines(basketId)).filter(hasDeal)) {
      const event = await store.appendSystemEvent(
        line.id,
        { t: "payment.status", status: "order_created", paypalOrderId: orderId },
        { transition: { from: ["agreed"], to: "payment_pending", required: true } },
      );
      if (event) await container.publish(event);
    }
  };

  /** One PayPal order for every closed line of the basket. */
  app.post<BasketParams>("/v1/baskets/:id/checkout", auth, async (req, reply) => {
    const basket = await ownBasket(req, reply);
    if (!basket) return reply;

    const existing = await store.getPaymentByBasket(basket.id);
    if (existing) {
      // A checkout interrupted after the order was stored finishes its locking here.
      if (existing.status === "order_created")
        await lockForPayment(basket.id, existing.paypalOrderId);
      return reply.send({ basketId: basket.id, ...paymentQuote(existing) });
    }

    const lines = await store.listBasketLines(basket.id);
    if (lines.some((l) => !isTerminal(l))) {
      return sendProblem(reply, 409, "still_negotiating", "Wait for every lane, or accept all.");
    }
    const closed = lines.filter(hasDeal);
    if (closed.length === 0) return sendProblem(reply, 409, "nothing_agreed");
    const amountCents = closed.reduce(
      (sum, l) => sum + lineCents(l.agreedPriceCents!, l.qty ?? 1),
      0,
    );
    if (amountCents <= 0) return sendProblem(reply, 422, "amount_too_small");

    // Hold the stock for this basket before asking for money, so the last unit
    // cannot be sold twice. The hold is released on failure or after its TTL.
    const hold = await store.reserveStock(
      basket.id,
      closed
        .filter((l) => l.shopItemId)
        .map((l) => ({ shopItemId: l.shopItemId!, qty: l.qty ?? 1 })),
    );
    if (!hold.ok) {
      const names = new Map(
        (await store.getShopItems(hold.shortage.map((s) => s.shopItemId))).map((i) => [
          i.id,
          i.name,
        ]),
      );
      return sendProblem(
        reply,
        409,
        "insufficient_stock",
        `Not enough stock: ${hold.shortage
          .map((s) => `${names.get(s.shopItemId) ?? "an item"} (${s.available} left)`)
          .join(", ")}.`,
      );
    }

    let quote: Awaited<ReturnType<typeof createCheckoutForDeal>>;
    try {
      quote = await createCheckoutForDeal(container, {
        referenceId: basket.id,
        amountCents,
        currency: basket.currency,
      });
    } catch (err) {
      await store.releaseReservations(basket.id);
      return sendKnownError(reply, err);
    }
    const { order, charged } = quote;
    await store.createPayment({
      basketId: basket.id,
      paypalOrderId: order.orderId,
      approveUrl: order.approveUrl,
      amountCents: charged.amountCents,
      currency: charged.currency,
      dealAmountCents: amountCents,
      dealCurrency: basket.currency,
      fxRate: charged.fxRate,
    });
    await lockForPayment(basket.id, order.orderId);
    return reply.code(201).send({
      basketId: basket.id,
      paypalOrderId: order.orderId,
      approveUrl: order.approveUrl,
      amountCents: charged.amountCents,
      currency: charged.currency,
      deal: { amountCents, currency: basket.currency },
      fxRate: charged.fxRate,
    });
  });

  /** Capture (after PayPal approval), settle every line, reveal every proof. Idempotent. */
  app.post<BasketParams>("/v1/baskets/:id/capture", auth, async (req, reply) => {
    const basket = await ownBasket(req, reply);
    if (!basket) return reply;
    const payment = await store.getPaymentByBasket(basket.id);
    if (!payment) return sendProblem(reply, 409, "no_checkout");
    if (payment.status === "failed" || payment.status === "refunded") {
      return sendProblem(reply, 409, `payment_${payment.status}`);
    }
    if (payment.status === "captured") {
      const proofs = await settleCapture(container, payment, payment.paypalCaptureId);
      return reply.send({
        basketId: basket.id,
        status: "captured",
        captureId: payment.paypalCaptureId,
        proofs,
      });
    }

    let capture: { captureId: string; status: string };
    try {
      capture = await checkout.capture(basket.id, payment.paypalOrderId);
    } catch (err) {
      return sendKnownError(reply, err);
    }
    // Only a COMPLETED capture settles; PENDING waits for PayPal's webhook.
    const result = await applyCapture(container, payment, capture);
    if (result.outcome === "failed") return sendProblem(reply, 409, "payment_failed");
    return reply.code(result.outcome === "pending" ? 202 : 200).send({
      basketId: basket.id,
      status: result.outcome === "pending" ? "approved" : "captured",
      captureId: capture.captureId,
      proofs: result.proofs,
    });
  });

  /**
   * Retry a denied or expired order: issue a fresh PayPal order for the same
   * agreed lines and re-lock them for checkout. The buyer keeps the prices they
   * haggled — no need to start over. Idempotent-ish: each call makes a new order.
   */
  app.post<BasketParams>("/v1/baskets/:id/retry", auth, async (req, reply) => {
    const basket = await ownBasket(req, reply);
    if (!basket) return reply;
    const payment = await store.getPaymentByBasket(basket.id);
    if (!payment) return sendProblem(reply, 409, "no_checkout");
    if (payment.status === "captured") return sendProblem(reply, 409, "already_paid");
    if (basket.state !== "failed" && basket.state !== "payment_pending") {
      return sendProblem(reply, 409, "not_retryable");
    }

    const closed = (await store.listBasketLines(basket.id)).filter(hasDeal);
    if (closed.length === 0) return sendProblem(reply, 409, "nothing_agreed");
    const amountCents = closed.reduce(
      (sum, l) => sum + lineCents(l.agreedPriceCents!, l.qty ?? 1),
      0,
    );
    if (amountCents <= 0) return sendProblem(reply, 422, "amount_too_small");

    const hold = await store.reserveStock(
      basket.id,
      closed
        .filter((l) => l.shopItemId)
        .map((l) => ({ shopItemId: l.shopItemId!, qty: l.qty ?? 1 })),
    );
    if (!hold.ok)
      return sendProblem(reply, 409, "insufficient_stock", "Not enough stock to retry.");

    let quote: Awaited<ReturnType<typeof createCheckoutForDeal>>;
    try {
      quote = await createCheckoutForDeal(container, {
        referenceId: basket.id,
        amountCents,
        currency: basket.currency,
      });
    } catch (err) {
      await store.releaseReservations(basket.id);
      return sendKnownError(reply, err);
    }
    const { order, charged } = quote;
    await store.replaceBasketOrder(basket.id, {
      paypalOrderId: order.orderId,
      approveUrl: order.approveUrl,
      amountCents: charged.amountCents,
      currency: charged.currency,
      dealAmountCents: amountCents,
      dealCurrency: basket.currency,
      fxRate: charged.fxRate,
    });
    await store.transitionBasket(basket.id, ["failed", "payment_pending"], "payment_pending");
    for (const line of closed) {
      if (line.state === "payment_pending") continue;
      const event = await store.appendSystemEvent(
        line.id,
        { t: "payment.status", status: "order_created", paypalOrderId: order.orderId },
        { transition: { from: ["failed"], to: "payment_pending", required: true } },
      );
      if (event) await container.publish(event);
    }
    return reply.code(201).send({
      basketId: basket.id,
      paypalOrderId: order.orderId,
      approveUrl: order.approveUrl,
      amountCents: charged.amountCents,
      currency: charged.currency,
      deal: { amountCents, currency: basket.currency },
      fxRate: charged.fxRate,
    });
  });

  /** Proof of Fair Deal for every closed line — only once the basket is paid. */
  app.get<BasketParams>("/v1/baskets/:id/proof", auth, async (req, reply) => {
    const basket = await ownBasket(req, reply);
    if (!basket) return reply;
    if (basket.state !== "paid") {
      return sendProblem(
        reply,
        409,
        "not_settled",
        "The proof is revealed once the basket is paid.",
      );
    }
    const proofs = [];
    for (const line of (await store.listBasketLines(basket.id)).filter(hasDeal)) {
      const proof = await revealProof(store, line.id, container.publish);
      if (proof) proofs.push(proof);
    }
    return reply.send({ basketId: basket.id, proofs });
  });
}
