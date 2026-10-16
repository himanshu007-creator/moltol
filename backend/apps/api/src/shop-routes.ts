import type { FastifyInstance, FastifyReply } from "fastify";
import { SHOP_STATUS_CHANNEL } from "@moltol/config";
import {
  CreateShopItemRequestSchema,
  CreateShopRequestSchema,
  NearbyQuerySchema,
  SetShopStatusRequestSchema,
  UpdateShopItemRequestSchema,
  UpdateShopRequestSchema,
  allowsFraction,
  isValidStock,
  toPublicShopItem,
  type ShopStatusEvent,
} from "@moltol/contracts";
import type { ShopRow } from "@moltol/store";
import type { Container } from "./container";
import { invalidBody, isUuid, sendProblem } from "./http";
import { streamShopStatus } from "./sse";
import { dealView, haversineM, nearbyView, shopItemView, shopStatus, shopView } from "./views";

const MINUTE = 60_000;

/** The same rules the frontend checks inline (list >= lowest price; stock fits the unit). */
function checkItem(
  reply: FastifyReply,
  item: { sellCents: number; floorCents: number; quantity: number | null; unit: string | null },
): FastifyReply | null {
  if (item.sellCents < item.floorCents) {
    return sendProblem(reply, 400, "invalid_price", "sellCents must be at least floorCents.");
  }
  if (item.quantity !== null && !isValidStock(item.quantity, item.unit)) {
    const rule = allowsFraction(item.unit) ? "at most 3 decimals" : "a whole number";
    return sendProblem(reply, 400, "invalid_quantity", `quantity must be ${rule} for this unit.`);
  }
  return null;
}

export async function registerShopRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  const { store, redis, env } = container;
  const auth = { preHandler: [app.authenticate] };

  const publishStatus = async (shop: ShopRow) => {
    const frame: ShopStatusEvent = { t: "shop.status", shopId: shop.id, status: shopStatus(shop) };
    await redis.publish(SHOP_STATUS_CHANNEL, JSON.stringify(frame));
  };

  /* ------------------------------- own shop -------------------------------- */

  app.post("/v1/shops/me", auth, async (req, reply) => {
    const parsed = CreateShopRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(reply, parsed.error);

    const existing = await store.getShopByUserId(req.user.sub);
    if (existing) return reply.send(shopView(existing));

    const { location, ...rest } = parsed.data;
    const shop = await store.createShop({
      userId: req.user.sub,
      ...rest,
      currency: env.DEFAULT_CURRENCY,
      ...(location ? { lat: location.lat, lng: location.lng } : {}),
    });
    return reply.code(201).send(shopView(shop));
  });

  app.get("/v1/shops/me", auth, async (req, reply) => {
    const shop = await store.getShopByUserId(req.user.sub);
    if (!shop) return sendProblem(reply, 404, "no_shop", "Create a shop first.");
    const items = await store.listShopItems(shop.id);
    return reply.send({ ...shopView(shop), items: items.map(shopItemView) });
  });

  app.patch("/v1/shops/me", auth, async (req, reply) => {
    const shop = await store.getShopByUserId(req.user.sub);
    if (!shop) return sendProblem(reply, 404, "no_shop", "Create a shop first.");
    const parsed = UpdateShopRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(reply, parsed.error);
    const { location, ...rest } = parsed.data;
    const updated = await store.updateShop(shop.id, {
      ...rest,
      ...(location !== undefined ? { lat: location?.lat ?? null, lng: location?.lng ?? null } : {}),
    });
    return reply.send(shopView(updated!));
  });

  /** Open/close now, or on a timer — the frontend's setOpen / closeIn / reopenIn. */
  app.put("/v1/shops/me/status", auth, async (req, reply) => {
    const shop = await store.getShopByUserId(req.user.sub);
    if (!shop) return sendProblem(reply, 404, "no_shop", "Create a shop first.");
    const parsed = SetShopStatusRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(reply, parsed.error);
    const { open, closeInMin, reopenInMin } = parsed.data;
    const now = Date.now();
    const updated = await store.updateShop(shop.id, {
      isOpen: open,
      closeAt: open && closeInMin ? new Date(now + closeInMin * MINUTE) : null,
      reopenAt: !open && reopenInMin ? new Date(now + reopenInMin * MINUTE) : null,
    });
    await publishStatus(updated!);
    return reply.send({ status: shopStatus(updated!) });
  });

  app.post("/v1/shops/me/items", auth, async (req, reply) => {
    const shop = await store.getShopByUserId(req.user.sub);
    if (!shop) return sendProblem(reply, 404, "no_shop", "Create a shop first.");

    const parsed = CreateShopItemRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(reply, parsed.error);
    const invalid = checkItem(reply, {
      ...parsed.data,
      quantity: parsed.data.quantity ?? null,
      unit: parsed.data.unit ?? null,
    });
    if (invalid) return invalid;

    const item = await store.createShopItem({ shopId: shop.id, ...parsed.data });
    return reply.code(201).send(shopItemView(item));
  });

  app.patch<{ Params: { itemId: string } }>(
    "/v1/shops/me/items/:itemId",
    auth,
    async (req, reply) => {
      const shop = await store.getShopByUserId(req.user.sub);
      if (!shop) return sendProblem(reply, 404, "no_shop");
      if (!isUuid(req.params.itemId)) return sendProblem(reply, 404, "not_found");

      const existing = await store.getShopItem(req.params.itemId);
      if (!existing || existing.shopId !== shop.id) return sendProblem(reply, 404, "not_found");

      const parsed = UpdateShopItemRequestSchema.safeParse(req.body);
      if (!parsed.success) return invalidBody(reply, parsed.error);
      const invalid = checkItem(reply, {
        sellCents: parsed.data.sellCents ?? existing.sellCents,
        floorCents: parsed.data.floorCents ?? existing.floorCents,
        quantity: parsed.data.quantity ?? existing.quantity,
        unit: parsed.data.unit ?? existing.unit,
      });
      if (invalid) return invalid;

      const updated = await store.updateShopItem(req.params.itemId, parsed.data);
      return reply.send(shopItemView(updated!));
    },
  );

  app.delete<{ Params: { itemId: string } }>(
    "/v1/shops/me/items/:itemId",
    auth,
    async (req, reply) => {
      const shop = await store.getShopByUserId(req.user.sub);
      if (!shop) return sendProblem(reply, 404, "no_shop");
      if (!isUuid(req.params.itemId)) return sendProblem(reply, 404, "not_found");

      const existing = await store.getShopItem(req.params.itemId);
      if (!existing || existing.shopId !== shop.id) return sendProblem(reply, 404, "not_found");

      await store.deleteShopItem(req.params.itemId);
      return reply.code(204).send();
    },
  );

  /** The seller's ledger feed: every line of every paid basket at this shop. */
  app.get<{ Querystring: { since?: string } }>("/v1/shops/me/deals", auth, async (req, reply) => {
    const shop = await store.getShopByUserId(req.user.sub);
    if (!shop) return sendProblem(reply, 404, "no_shop", "Create a shop first.");
    let since: Date | undefined;
    if (req.query.since !== undefined) {
      since = new Date(req.query.since);
      if (Number.isNaN(since.getTime())) return sendProblem(reply, 400, "invalid_since");
    }
    const baskets = await store.listPaidShopBaskets(shop.id, since);
    const byId = new Map(baskets.map((b) => [b.id, b]));
    const lines = await store.listBasketLinesFor(baskets.map((b) => b.id));
    const deals = lines.map((line) => dealView(line, byId.get(line.basketId!)!));
    deals.sort((a, b) => b.ts.localeCompare(a.ts));
    return reply.send(deals);
  });

  /* ------------------------------ public views ----------------------------- */

  /** Stalls with a location near a point: open ones by distance, closed ones after. */
  app.get("/v1/shops/nearby", async (req, reply) => {
    const parsed = NearbyQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalidBody(reply, parsed.error);
    const { lat, lng, radiusM } = parsed.data;
    const dLat = radiusM / 111_320;
    const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
    const candidates = await store.shopsInBox({
      minLat: lat - dLat,
      maxLat: lat + dLat,
      minLng: lng - dLng,
      maxLng: lng + dLng,
    });
    const near = candidates
      .map((shop) => ({
        shop,
        distanceM: haversineM({ lat, lng }, { lat: shop.lat!, lng: shop.lng! }),
      }))
      .filter((s) => s.distanceM <= radiusM);
    const counts = await store.countItemsByShop(near.map((s) => s.shop.id));
    const views = near.map((s) => nearbyView(s.shop, s.distanceM, counts.get(s.shop.id) ?? 0));
    views.sort(
      (a, b) => Number(b.status.open) - Number(a.status.open) || a.distanceM - b.distanceM,
    );
    return reply.send(views);
  });

  /** Live `shop.status` frames for every stall map (SSE). */
  app.get("/v1/shops/status/stream", { exposeHeadRoute: false }, async (req, reply) => {
    await streamShopStatus(req, reply, redis);
  });

  /** Buyer-facing shop: `floorCents` stripped from every item. */
  app.get<{ Params: { shopId: string } }>("/v1/shops/:shopId", async (req, reply) => {
    if (!isUuid(req.params.shopId)) return sendProblem(reply, 404, "not_found");
    const shop = await store.getShopById(req.params.shopId);
    if (!shop) return sendProblem(reply, 404, "not_found");
    const items = await store.listShopItems(shop.id);
    return reply.send({
      ...shopView(shop),
      items: items.map((i) => toPublicShopItem(shopItemView(i))),
    });
  });
}
