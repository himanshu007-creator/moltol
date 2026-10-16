import type { FastifyInstance } from "fastify";
import type { Order } from "@moltol/contracts";
import type { BasketRow } from "@moltol/store";
import type { Container } from "./container";
import { isUuid, sendProblem } from "./http";
import { orderView } from "./views";

/**
 * A buyer's orders are their checked-out baskets (any basket with a PayPal
 * order), newest first, in the frontend's `Order` vocabulary.
 */
export async function registerOrderRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  const { store } = container;
  const auth = { preHandler: [app.authenticate] };

  const ordersFor = async (baskets: BasketRow[]): Promise<Order[]> => {
    const payments = new Map(
      (await store.getPaymentsByBaskets(baskets.map((b) => b.id))).map((p) => [p.basketId!, p]),
    );
    const paidFor = baskets.filter((b) => payments.has(b.id));
    if (paidFor.length === 0) return [];
    const lines = await store.listBasketLinesFor(paidFor.map((b) => b.id));
    const proofs = await store.getProofs(lines.map((l) => l.id));
    const shops = new Map<string, Awaited<ReturnType<typeof store.getShopById>>>();
    for (const shopId of new Set(paidFor.map((b) => b.shopId))) {
      shops.set(shopId, await store.getShopById(shopId));
    }
    return paidFor.map((b) =>
      orderView(
        b,
        shops.get(b.shopId) ?? null,
        lines.filter((l) => l.basketId === b.id),
        payments.get(b.id)!,
        proofs,
      ),
    );
  };

  app.get("/v1/orders", auth, async (req, reply) => {
    return reply.send(await ordersFor(await store.listBuyerBaskets(req.user.sub)));
  });

  app.get<{ Params: { id: string } }>("/v1/orders/:id", auth, async (req, reply) => {
    const basket = isUuid(req.params.id) ? await store.getBasket(req.params.id) : null;
    if (!basket || basket.buyerUserId !== req.user.sub) return sendProblem(reply, 404, "not_found");
    const [order] = await ordersFor([basket]);
    if (!order) return sendProblem(reply, 404, "not_found");
    return reply.send(order);
  });
}
