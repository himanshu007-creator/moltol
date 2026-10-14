import type { FastifyInstance, FastifyReply } from "fastify";
import {
  CreateShopItemRequestSchema,
  CreateShopRequestSchema,
  UpdateShopItemRequestSchema,
  problem,
  toPublicShopItem,
  type ShopItem,
} from "@moltol/contracts";
import type { Container } from "./container";

function sendProblem(reply: FastifyReply, status: number, title: string, detail?: string): void {
  reply
    .code(status)
    .type("application/problem+json")
    .send(problem(status, title, detail));
}

function toShopItemContract(row: {
  id: string;
  shopId: string;
  name: string;
  emoji: string | null;
  sellCents: number;
  floorCents: number;
  quantity: number | null;
  unit: string | null;
  hindiName: string | null;
}): ShopItem {
  return row;
}

export async function registerShopRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  const { store } = container;

  app.post("/v1/shops/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = CreateShopRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return sendProblem(reply, 400, "invalid_body", JSON.stringify(parsed.error.flatten()));

    const existing = await store.getShopByUserId(req.user.sub);
    if (existing)
      return reply.send({ id: existing.id, name: existing.name, emoji: existing.emoji });

    const shop = await store.createShop({ userId: req.user.sub, ...parsed.data });
    return reply.code(201).send({ id: shop.id, name: shop.name, emoji: shop.emoji });
  });

  app.get("/v1/shops/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const shop = await store.getShopByUserId(req.user.sub);
    if (!shop) return sendProblem(reply, 404, "no_shop", "Create a shop first.");
    const items = await store.listShopItems(shop.id);
    return reply.send({
      id: shop.id,
      name: shop.name,
      emoji: shop.emoji,
      items: items.map(toShopItemContract),
    });
  });

  app.post("/v1/shops/me/items", { preHandler: [app.authenticate] }, async (req, reply) => {
    const shop = await store.getShopByUserId(req.user.sub);
    if (!shop) return sendProblem(reply, 404, "no_shop", "Create a shop first.");

    const parsed = CreateShopItemRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return sendProblem(reply, 400, "invalid_body", JSON.stringify(parsed.error.flatten()));
    if (parsed.data.sellCents <= parsed.data.floorCents) {
      return sendProblem(reply, 400, "invalid_price", "sellCents must be greater than floorCents.");
    }

    const item = await store.createShopItem({ shopId: shop.id, ...parsed.data });
    return reply.code(201).send(toShopItemContract(item));
  });

  app.patch<{ Params: { itemId: string } }>(
    "/v1/shops/me/items/:itemId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const shop = await store.getShopByUserId(req.user.sub);
      if (!shop) return sendProblem(reply, 404, "no_shop");

      const existing = await store.getShopItem(req.params.itemId);
      if (!existing || existing.shopId !== shop.id) return sendProblem(reply, 404, "not_found");

      const parsed = UpdateShopItemRequestSchema.safeParse(req.body);
      if (!parsed.success)
        return sendProblem(reply, 400, "invalid_body", JSON.stringify(parsed.error.flatten()));

      const sellCents = parsed.data.sellCents ?? existing.sellCents;
      const floorCents = parsed.data.floorCents ?? existing.floorCents;
      if (sellCents <= floorCents) {
        return sendProblem(
          reply,
          400,
          "invalid_price",
          "sellCents must be greater than floorCents.",
        );
      }

      const updated = await store.updateShopItem(req.params.itemId, parsed.data);
      return reply.send(toShopItemContract(updated!));
    },
  );

  app.delete<{ Params: { itemId: string } }>(
    "/v1/shops/me/items/:itemId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const shop = await store.getShopByUserId(req.user.sub);
      if (!shop) return sendProblem(reply, 404, "no_shop");

      const existing = await store.getShopItem(req.params.itemId);
      if (!existing || existing.shopId !== shop.id) return sendProblem(reply, 404, "not_found");

      await store.deleteShopItem(req.params.itemId);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { shopId: string } }>("/v1/shops/:shopId", async (req, reply) => {
    const shop = await store.getShopById(req.params.shopId);
    if (!shop) return sendProblem(reply, 404, "not_found");
    const items = await store.listShopItems(shop.id);
    return reply.send({
      id: shop.id,
      name: shop.name,
      emoji: shop.emoji,
      items: items.map((i) => toPublicShopItem(toShopItemContract(i))),
    });
  });
}
