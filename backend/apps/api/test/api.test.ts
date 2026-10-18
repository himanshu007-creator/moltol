import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NegotiationEvent } from "@moltol/contracts";
import { runHaggle } from "@moltol/engine";
import { fromHex, verifyReveal } from "@moltol/policy";
import { createDb, runMigrations } from "@moltol/store";
import { buildApp, type BuiltApp } from "../src/app";
import { createContainer, type Container } from "../src/container";
import { parseEnv } from "../src/env";

/**
 * End-to-end through the real Fastify app, Postgres and Redis. Runs when
 * TEST_DATABASE_URL and TEST_REDIS_URL point at throwaway instances (CI starts
 * them as services); skipped otherwise. The worker is replaced by an in-process
 * runner calling the same `runHaggle`, unpaced.
 */
const DB = process.env.TEST_DATABASE_URL;
const REDIS = process.env.TEST_REDIS_URL;

describe.skipIf(!DB || !REDIS)("api against postgres + redis", () => {
  let built: BuiltApp;
  let c: Container;
  let sql: ReturnType<typeof createDb>["sql"];
  const haggles: Promise<unknown>[] = [];
  let holdLanes = false; // when set, new lanes are left for a human
  let ipCounter = 0;

  const freshIp = () => `10.1.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
  const settle = async () => {
    while (haggles.length) await Promise.all(haggles.splice(0));
  };
  const inject: BuiltApp["app"]["inject"] = ((opts: object) =>
    built.app.inject({ remoteAddress: freshIp(), ...opts } as never)) as never;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await runMigrations(DB!);
    sql = createDb(DB!).sql;
    await sql`TRUNCATE negotiations, negotiation_events, sealed_secrets, payments, webhook_events, proofs, users, otp_codes, shops, shop_items, baskets`;
    const parsed = parseEnv({
      NODE_ENV: "test",
      DATABASE_URL: DB,
      REDIS_URL: REDIS,
      LOG_LEVEL: "silent",
      TRUST_PROXY: "false",
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    c = createContainer(parsed.env);
    await c.redis.flushdb();
    const runner = {
      async enqueue(id: string) {
        if (!holdLanes) haggles.push(runHaggle(id, c.engine()));
      },
    };
    built = await buildApp({ env: parsed.env, container: c, runner, logger: false });
    await built.app.ready();
  });

  afterAll(async () => {
    await settle().catch(() => {});
    await built?.app.close();
    await c?.close();
    await sql?.end();
  });

  /** Sign up + verify by email OTP (no SMTP in tests: the code is logged, so read the log). */
  async function register(): Promise<{
    token: string;
    email: string;
    password: string;
    id: string;
  }> {
    const email = `u${randomUUID().slice(0, 8)}@example.com`;
    const password = "correct horse battery";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email, password },
    });
    const line = spy.mock.calls.map((call) => String(call[0])).find((l) => l.includes(email));
    spy.mockRestore();
    expect(res.statusCode).toBe(201);
    const code = /is (\d{6})/.exec(line ?? "")![1]!;
    const verify = await inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { email, code },
    });
    expect(verify.statusCode).toBe(200);
    const body = verify.json();
    return { token: body.token, email, password, id: body.user.id };
  }

  async function sellerWithItems(location = { lat: 31.2884, lng: 75.5968 }) {
    const seller = await register();
    const shop = await inject({
      method: "POST",
      url: "/v1/shops/me",
      headers: bearer(seller.token),
      payload: { name: "Demo ki Dukaan", emoji: "🏪", location },
    });
    expect(shop.statusCode).toBe(201);
    const add = async (item: object) => {
      const res = await inject({
        method: "POST",
        url: "/v1/shops/me/items",
        headers: bearer(seller.token),
        payload: item,
      });
      expect(res.statusCode).toBe(201);
      return res.json() as { id: string; sellCents: number; floorCents: number };
    };
    const tomato = await add({
      name: "Tomato",
      emoji: "🍅",
      sellCents: 4000,
      floorCents: 3000,
      unit: "kg",
      quantity: 10,
    });
    const onion = await add({
      name: "Onion",
      emoji: "🧅",
      sellCents: 3500,
      floorCents: 2000,
      unit: "piece",
      quantity: 5,
    });
    const atta = await add({
      name: "Atta",
      emoji: "🌾",
      sellCents: 29000,
      floorCents: 24000,
      unit: "pack",
    });
    return { seller, shopId: shop.json().id as string, tomato, onion, atta };
  }

  /* ---------------------------------- auth ---------------------------------- */

  it("auth: sessions expire, log out one at a time, and all die on a password reset", async () => {
    const u = await register();
    const me = await inject({ method: "GET", url: "/v1/me", headers: bearer(u.token) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      activeRole: "buyer",
      hagglePreset: "balanced",
      hasShop: false,
    });

    const claims = built.app.jwt.decode<{ iat: number; exp: number }>(u.token)!;
    expect(claims.exp - claims.iat).toBe(7 * 24 * 3600);

    expect(
      (
        await inject({
          method: "PATCH",
          url: "/v1/me/role",
          headers: bearer(u.token),
          payload: { activeRole: "seller" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await inject({
          method: "PUT",
          url: "/v1/me/preferences/haggle",
          headers: bearer(u.token),
          payload: { preset: "hard" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await inject({ method: "GET", url: "/v1/me", headers: bearer(u.token) })).json(),
    ).toMatchObject({
      activeRole: "seller",
      hagglePreset: "hard",
    });

    // logout ends this session only
    const second = (
      await inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: u.email, password: u.password },
      })
    ).json().token;
    expect(
      (await inject({ method: "POST", url: "/v1/auth/logout", headers: bearer(u.token) }))
        .statusCode,
    ).toBe(204);
    expect(
      (await inject({ method: "GET", url: "/v1/me", headers: bearer(u.token) })).statusCode,
    ).toBe(401);
    expect(
      (await inject({ method: "GET", url: "/v1/me", headers: bearer(second) })).statusCode,
    ).toBe(200);

    // a reset revokes every older session
    await sql`UPDATE otp_codes SET created_at = now() - interval '5 minutes' WHERE user_id = ${u.id}`;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await inject({ method: "POST", url: "/v1/auth/password/forgot", payload: { email: u.email } });
    const line = spy.mock.calls.map((call) => String(call[0])).find((l) => l.includes(u.email));
    spy.mockRestore();
    const code = /is (\d{6})/.exec(line ?? "")![1]!;
    const reset = await inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { email: u.email, code, newPassword: "a brand new password" },
    });
    expect(reset.statusCode).toBe(200);
    expect(
      (await inject({ method: "GET", url: "/v1/me", headers: bearer(second) })).statusCode,
    ).toBe(401);
    expect(
      (await inject({ method: "GET", url: "/v1/me", headers: bearer(reset.json().token) }))
        .statusCode,
    ).toBe(200);

    // tokens minted before revocation existed (no tv/jti, no expiry) are refused
    const legacy = built.app.jwt.sign({ sub: u.id, email: u.email } as never, { expiresIn: "1h" });
    expect(
      (await inject({ method: "GET", url: "/v1/me", headers: bearer(legacy) })).statusCode,
    ).toBe(401);
  });

  it("auth: throttles credential guessing per client IP", async () => {
    const ip = "10.250.0.1";
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await built.app.inject({
        method: "POST",
        url: "/v1/auth/login",
        remoteAddress: ip,
        payload: { email: "nobody@example.com", password: "wrong" },
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  /* ---------------------------------- shops --------------------------------- */

  it("shops: items follow the frontend's price and unit rules; buyers never see floors", async () => {
    const { seller, shopId } = await sellerWithItems();
    const post = (item: object) =>
      inject({
        method: "POST",
        url: "/v1/shops/me/items",
        headers: bearer(seller.token),
        payload: item,
      });

    // list == lowest price is allowed (the Simple-mode form rounds ₹1–₹2 items to that)
    expect(
      (await post({ name: "Lemon", sellCents: 100, floorCents: 100, unit: "piece" })).statusCode,
    ).toBe(201);
    expect((await post({ name: "Bad", sellCents: 100, floorCents: 101 })).json().title).toBe(
      "invalid_price",
    );
    expect(
      (
        await post({ name: "Half", sellCents: 500, floorCents: 400, unit: "piece", quantity: 1.5 })
      ).json().title,
    ).toBe("invalid_quantity");
    expect(
      (await post({ name: "Dal", sellCents: 500, floorCents: 400, unit: "kg", quantity: 2.25 }))
        .statusCode,
    ).toBe(201);

    const pub = await inject({ method: "GET", url: `/v1/shops/${shopId}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().status.open).toBe(true);
    expect(JSON.stringify(pub.json())).not.toContain("floorCents");
    expect((await inject({ method: "GET", url: "/v1/shops/not-a-uuid" })).statusCode).toBe(404);
  });

  it("shops: nearby lists open stalls by distance, closed ones last; a closed stall takes no baskets", async () => {
    const here = { lat: 12.9716, lng: 77.5946 };
    const near = await sellerWithItems({ lat: 12.972, lng: 77.595 });
    const nearer = await sellerWithItems({ lat: 12.9717, lng: 77.5947 });
    const closed = await inject({
      method: "PUT",
      url: "/v1/shops/me/status",
      headers: bearer(nearer.seller.token),
      payload: { open: false, reopenInMin: 30 },
    });
    expect(closed.json().status).toMatchObject({ open: false, closeAt: null });
    expect(closed.json().status.reopenAt).toBeGreaterThan(Date.now());

    const list = (
      await inject({
        method: "GET",
        url: `/v1/shops/nearby?lat=${here.lat}&lng=${here.lng}&radiusM=2000`,
      })
    ).json();
    const ids = list.map((s: { id: string }) => s.id);
    expect(ids.indexOf(near.shopId)).toBeLessThan(ids.indexOf(nearer.shopId));
    expect(list.find((s: { id: string }) => s.id === nearer.shopId).status.open).toBe(false);

    const buyer = await register();
    const refused = await inject({
      method: "POST",
      url: "/v1/baskets",
      headers: bearer(buyer.token),
      payload: { shopId: nearer.shopId, lines: [{ itemId: nearer.tomato.id, qty: 1 }] },
    });
    expect(refused.json().title).toBe("shop_closed");

    const timer = await inject({
      method: "PUT",
      url: "/v1/shops/me/status",
      headers: bearer(nearer.seller.token),
      payload: { open: false, closeInMin: 5 },
    });
    expect(timer.statusCode).toBe(400);
  });

  /* --------------------------------- baskets -------------------------------- */

  it("basket: every lane lands in [floor, list], one PayPal order pays it, every line is proved", async () => {
    const { seller, shopId, tomato, onion } = await sellerWithItems();
    const buyer = await register();
    const created = await inject({
      method: "POST",
      url: "/v1/baskets",
      headers: bearer(buyer.token),
      payload: {
        shopId,
        lines: [
          { itemId: tomato.id, qty: 0.5 },
          { itemId: onion.id, qty: 2 },
        ],
        request: { rounds: 5, tone: "playful", preset: "balanced" },
      },
    });
    expect(created.statusCode).toBe(201);
    const basketId = created.json().id as string;
    await settle();

    const basket = (
      await inject({ method: "GET", url: `/v1/baskets/${basketId}`, headers: bearer(buyer.token) })
    ).json();
    expect(basket.state).toBe("settled");
    for (const [line, item] of [
      [basket.lines[0], tomato],
      [basket.lines[1], onion],
    ] as const) {
      expect(line.state).toBe("agreed");
      expect(line.agreedUnitCents).toBeGreaterThanOrEqual(item.floorCents);
      expect(line.agreedUnitCents).toBeLessThanOrEqual(item.sellCents);
      expect(line.agreedLineCents).toBe(Math.round(line.agreedUnitCents * line.qty));
    }
    const amount = basket.lines.reduce(
      (s: number, l: { agreedLineCents: number }) => s + l.agreedLineCents,
      0,
    );
    expect(basket.totals.agreedCents).toBe(amount);

    // other buyers can't see it; the proof waits for payment
    const stranger = await register();
    expect(
      (
        await inject({
          method: "GET",
          url: `/v1/baskets/${basketId}`,
          headers: bearer(stranger.token),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await inject({
          method: "GET",
          url: `/v1/baskets/${basketId}/proof`,
          headers: bearer(buyer.token),
        })
      ).json().title,
    ).toBe("not_settled");

    const checkout = await inject({
      method: "POST",
      url: `/v1/baskets/${basketId}/checkout`,
      headers: bearer(buyer.token),
    });
    expect(checkout.statusCode).toBe(201);
    // The shop prices in INR; PayPal is charged in USD at FX_USD_PER_INR (default 0.012).
    expect(checkout.json()).toMatchObject({
      amountCents: Math.round(amount * 0.012),
      currency: "USD",
      deal: { amountCents: amount, currency: "INR" },
      fxRate: 0.012,
      paypalOrderId: `MOCK-${basketId}`,
    });
    const again = await inject({
      method: "POST",
      url: `/v1/baskets/${basketId}/checkout`,
      headers: bearer(buyer.token),
    });
    expect(again.json().paypalOrderId).toBe(checkout.json().paypalOrderId);
    const locked = await inject({
      method: "POST",
      url: `/v1/baskets/${basketId}/lines/${basket.lines[0].lineItemId}/accept`,
      headers: bearer(buyer.token),
    });
    expect(locked.json().title).toBe("checkout_started");

    const capture = await inject({
      method: "POST",
      url: `/v1/baskets/${basketId}/capture`,
      headers: bearer(buyer.token),
    });
    expect(capture.statusCode).toBe(200);
    const proofs = capture.json().proofs as {
      negotiationId: string;
      verified: boolean;
      reveal: {
        buyerLimitCents: number;
        buyerSalt: string;
        shopFloorCents: number;
        shopSalt: string;
      };
    }[];
    expect(proofs).toHaveLength(2);
    // anyone can recompute the commitments published before the first turn
    for (const proof of proofs) {
      expect(proof.verified).toBe(true);
      const events = await c.store.listEvents(proof.negotiationId);
      const sealed = events.find((e) => e.t === "limits.sealed") as Extract<
        NegotiationEvent,
        { t: "limits.sealed" }
      >;
      const ctx = { negotiationId: proof.negotiationId, currency: "INR" };
      expect(
        verifyReveal(
          sealed.buyerCommit,
          { ...ctx, side: "buyer", limitCents: proof.reveal.buyerLimitCents },
          fromHex(proof.reveal.buyerSalt),
        ),
      ).toBe(true);
      expect(
        verifyReveal(
          sealed.shopCommit,
          { ...ctx, side: "shop", limitCents: proof.reveal.shopFloorCents },
          fromHex(proof.reveal.shopSalt),
        ),
      ).toBe(true);
    }
    // The shop's sealed limit is a per-line reserve above the vendor's floor: the
    // vendor's standing floor itself is never revealed, and never undercut.
    for (const proof of proofs) {
      const item = [tomato, onion].find((i) =>
        basket.lines.some(
          (l: { lineItemId: string; itemId: string }) =>
            l.lineItemId === proof.negotiationId && l.itemId === i.id,
        ),
      )!;
      expect(proof.reveal.shopFloorCents).toBeGreaterThanOrEqual(item.floorCents + 100);
      expect(proof.reveal.shopFloorCents).toBeLessThanOrEqual(
        item.floorCents + Math.ceil(0.3 * (item.sellCents - item.floorCents)),
      );
    }

    // capturing again changes nothing: one capture event and one proof per line
    await inject({
      method: "POST",
      url: `/v1/baskets/${basketId}/capture`,
      headers: bearer(buyer.token),
    });
    for (const line of basket.lines) {
      const events = await c.store.listEvents(line.lineItemId);
      expect(events.filter((e) => e.t === "proof.revealed")).toHaveLength(1);
      expect(
        events.filter((e) => e.t === "payment.status" && e.status === "captured"),
      ).toHaveLength(1);
      expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
      expect(
        events.filter((e) => e.t === "deal.agreed").every((e) => e.fairness === undefined),
      ).toBe(true);
    }

    // stock went out once; the order and the seller's ledger both see it
    const mine = (
      await inject({ method: "GET", url: "/v1/shops/me", headers: bearer(seller.token) })
    ).json();
    const stock = Object.fromEntries(
      mine.items.map((i: { id: string; quantity: number }) => [i.id, i.quantity]),
    );
    expect(stock[tomato.id]).toBe(9.5);
    expect(stock[onion.id]).toBe(3);

    const orders = (
      await inject({ method: "GET", url: "/v1/orders", headers: bearer(buyer.token) })
    ).json();
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: basketId,
      totalCents: amount,
      paymentStatus: "captured",
      proofVerified: true,
    });
    const deals = (
      await inject({ method: "GET", url: "/v1/shops/me/deals", headers: bearer(seller.token) })
    ).json();
    expect(deals).toHaveLength(2);
    expect(deals.every((d: { won: boolean }) => d.won)).toBe(true);
  });

  it("basket: a human takes a lane over, is held to the ceiling, counters, accepts; accept-all closes the rest", async () => {
    const { shopId, tomato, onion, atta } = await sellerWithItems();
    const buyer = await register();
    holdLanes = true;
    const created = await inject({
      method: "POST",
      url: "/v1/baskets",
      headers: bearer(buyer.token),
      payload: {
        shopId,
        lines: [
          { itemId: tomato.id, qty: 1 },
          { itemId: onion.id, qty: 1 },
          { itemId: atta.id, qty: 1 },
        ],
      },
    });
    holdLanes = false;
    const basketId = created.json().id as string;
    const [lane, other] = created.json().lines as { lineItemId: string }[];
    const at = (lineId: string, action: string, payload?: object) =>
      inject({
        method: "POST",
        url: `/v1/baskets/${basketId}/lines/${lineId}/${action}`,
        headers: bearer(buyer.token),
        ...(payload ? { payload } : {}),
      });

    expect((await at(other!.lineItemId, "offer", { priceCents: 3000 })).json().title).toBe(
      "not_controlled",
    );
    const taken = await at(lane!.lineItemId, "takeover");
    expect(taken.statusCode).toBe(200);
    expect(taken.json().line.controlled).toBe(true);

    expect(
      (await at(lane!.lineItemId, "offer", { priceCents: tomato.sellCents + 1 })).json().title,
    ).toBe("above_ceiling");
    const first = (await at(lane!.lineItemId, "offer", { priceCents: 1000 })).json();
    expect(first).toMatchObject({ accepted: false, counterCents: tomato.sellCents });
    const second = (await at(lane!.lineItemId, "offer", { priceCents: 1000 })).json();
    expect(second.counterCents).toBeLessThan(tomato.sellCents);
    expect(second.counterCents).toBeGreaterThan(tomato.floorCents);

    const accepted = (await at(lane!.lineItemId, "accept")).json();
    expect(accepted.accepted).toBe(true);
    expect(accepted.line.agreedUnitCents).toBe(second.counterCents);

    const all = await inject({
      method: "POST",
      url: `/v1/baskets/${basketId}/accept-all`,
      headers: bearer(buyer.token),
    });
    expect(all.statusCode).toBe(200);
    expect(all.json().agreed).toHaveLength(3);
    expect(all.json().basket.state).toBe("settled");
  });

  /* ---------------------------- standalone + misc ---------------------------- */

  it("standalone negotiation: the proof is revealed only after payment, and only once", async () => {
    const created = await inject({
      method: "POST",
      url: "/v1/negotiations",
      payload: { query: "water bottle", maxTotalCents: 10_000 },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    await settle();
    expect((await inject({ method: "GET", url: `/v1/negotiations/${id}` })).json().state).toBe(
      "agreed",
    );
    expect(
      (await inject({ method: "GET", url: `/v1/negotiations/${id}/proof` })).json().title,
    ).toBe("not_settled");

    expect(
      (await inject({ method: "POST", url: `/v1/negotiations/${id}/checkout` })).statusCode,
    ).toBe(201);
    const capture = await inject({ method: "POST", url: `/v1/negotiations/${id}/capture` });
    expect(capture.json().proof).toMatchObject({ verified: true });
    expect(capture.json().proof.reveal).toBeDefined();
    await inject({ method: "GET", url: `/v1/negotiations/${id}/proof` });
    await inject({ method: "GET", url: `/v1/negotiations/${id}/proof` });
    const events = await c.store.listEvents(id);
    expect(events.filter((e) => e.t === "proof.revealed")).toHaveLength(1);
    expect((await inject({ method: "GET", url: `/v1/negotiations/${id}` })).json().state).toBe(
      "revealed",
    );
  });

  it("webhook: an unverifiable event is refused before it can touch a payment", async () => {
    const headers = {
      "paypal-transmission-id": "t-1",
      "paypal-transmission-time": new Date().toISOString(),
      "paypal-transmission-sig": "Zm9yZ2Vk",
      "paypal-cert-url": "https://evil.example.com/cert.pem",
      "paypal-auth-algo": "SHA256withRSA",
    };
    const res = await inject({
      method: "POST",
      url: "/v1/webhooks/paypal",
      headers,
      payload: {
        id: "WH-forged",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: { id: "CAP-1" },
      },
    });
    expect(res.statusCode).toBe(401);
    expect(
      (await inject({ method: "POST", url: "/v1/webhooks/paypal", payload: {} })).statusCode,
    ).toBe(401);
  });

  it("robustness: malformed ids are 404s and malformed JSON is a 400 problem, never a 500", async () => {
    expect((await inject({ method: "GET", url: "/v1/negotiations/not-a-uuid" })).statusCode).toBe(
      404,
    );
    expect(
      (await inject({ method: "GET", url: "/v1/negotiations/not-a-uuid/proof" })).statusCode,
    ).toBe(404);
    const bad = await inject({
      method: "POST",
      url: "/v1/negotiations",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.headers["content-type"]).toContain("application/problem+json");
    expect((await inject({ method: "GET", url: "/v1/nowhere" })).json().title).toBe("not_found");
  });

  it("event log: concurrent writers never drop or duplicate a seq", async () => {
    const n = await c.store.createNegotiation({
      query: "load",
      persona: "analyst",
      maxTotalCents: 1000,
      currency: "USD",
      roundsMax: 4,
    });
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        c.store.appendSystemEvent(n.id, { t: "error", code: "test", message: String(i) }),
      ),
    );
    const events = await c.store.listEvents(n.id);
    expect(events.map((e) => e.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });

  /* ----------------------------------- SSE ----------------------------------- */

  async function readSse(
    url: string,
    headers: Record<string, string>,
    stopAt: (n: number) => boolean,
    ms = 3000,
  ) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    const res = await fetch(url, { headers, signal: ac.signal });
    const frames: { id?: string; data: NegotiationEvent }[] = [];
    let buffer = "";
    try {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const id = /^id: (.*)$/m.exec(raw)?.[1];
          const data = /^data: (.*)$/m.exec(raw)?.[1];
          if (data) frames.push({ ...(id ? { id } : {}), data: JSON.parse(data) });
        }
        if (stopAt(frames.length)) break;
      }
    } catch (err) {
      if (!ac.signal.aborted) throw err;
    } finally {
      clearTimeout(timer);
      ac.abort();
    }
    return { frames, headers: res.headers };
  }

  it("sse: backfills every lane, tails live events, carries CORS, and resumes from Last-Event-ID", async () => {
    await built.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (built.app.server.address() as AddressInfo).port;
    const { shopId, tomato, onion } = await sellerWithItems();
    const buyer = await register();
    holdLanes = true;
    const created = await inject({
      method: "POST",
      url: "/v1/baskets",
      headers: bearer(buyer.token),
      payload: {
        shopId,
        lines: [
          { itemId: tomato.id, qty: 1 },
          { itemId: onion.id, qty: 1 },
        ],
      },
    });
    holdLanes = false;
    const basketId = created.json().id as string;
    const url = `http://127.0.0.1:${port}/v1/baskets/${basketId}/events`;
    const lineId = created.json().lines[0].lineItemId as string;

    // live: the takeover happens while the stream is open
    const live = readSse(url, { origin: "http://localhost:4321" }, (n) => n >= 3);
    await new Promise((r) => setTimeout(r, 300));
    await inject({
      method: "POST",
      url: `/v1/baskets/${basketId}/lines/${lineId}/takeover`,
      headers: bearer(buyer.token),
    });
    const first = await live;
    expect(first.headers.get("access-control-allow-origin")).toBeTruthy();
    expect(first.frames.map((f) => f.data.t)).toEqual([
      "session.started",
      "limits.sealed",
      "control.changed",
    ]);
    expect(first.frames.every((f) => f.data.audience === "all")).toBe(true);
    const cursor = first.frames[first.frames.length - 1]!.id!;
    expect(cursor).toBe("2.-1");

    // the other lane moves; a reconnect with the cursor gets only what it missed
    await inject({
      method: "POST",
      url: `/v1/baskets/${basketId}/accept-all`,
      headers: bearer(buyer.token),
    });
    const resumed = await readSse(url, { "last-event-id": cursor }, () => false, 800);
    const seen = resumed.frames.map(
      (f) => `${f.data.negotiationId === lineId ? "a" : "b"}${f.data.seq}`,
    );
    expect(seen.filter((s) => s.startsWith("a")).every((s) => Number(s.slice(1)) > 2)).toBe(true);
    expect(seen).toContain("b0");
    expect(new Set(seen).size).toBe(seen.length);
  });
});
