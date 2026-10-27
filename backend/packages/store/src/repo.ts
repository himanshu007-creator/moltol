import { randomUUID } from "node:crypto";
import type {
  Audience,
  CreateNegotiationInput,
  EventInput,
  MarketRange,
  Negotiation,
  NegotiationEvent,
  NegotiationState,
  Persona,
  Side,
  Turn,
} from "@moltol/contracts";
import { sealAad } from "@moltol/config";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  sql as raw,
} from "drizzle-orm";
import type { Db, Sql } from "./client";
import { decryptLimit, encryptLimit, parseSealKey } from "./seal";
import {
  baskets,
  negotiationEvents,
  negotiations,
  otpCodes,
  payments,
  proofs,
  reservations,
  sealedSecrets,
  shopItems,
  shops,
  stockAdjustments,
  users,
  webhookEvents,
} from "./schema";

type NegotiationRow = typeof negotiations.$inferSelect;
type EventRow = typeof negotiationEvents.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type BasketRow = typeof baskets.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type ShopRow = typeof shops.$inferSelect;
export type UserRow = typeof users.$inferSelect;

/** `numeric` columns come back as strings; quantities are plain numbers everywhere else. */
function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function toNegotiation(row: NegotiationRow): Negotiation {
  return {
    id: row.id,
    state: row.state as NegotiationState,
    query: row.query,
    persona: row.persona as Persona,
    roundsMax: row.roundsMax,
    maxTotalCents: row.maxTotalCents,
    currency: row.currency,
    agreedPriceCents: row.agreedPriceCents,
    paypalOrderId: row.paypalOrderId,
    paypalCaptureId: row.paypalCaptureId,
    market: row.market,
    turns: row.turns,
    basketId: row.basketId,
    lineIndex: row.lineIndex,
    shopItemId: row.shopItemId,
    itemEmoji: row.itemEmoji,
    itemUnit: row.itemUnit,
    qty: toNumber(row.qty),
    openCents: row.openCents,
    shopPersona: row.shopPersona as Persona | null,
    controlled: row.controlled,
    createdAt: row.createdAt.toISOString(),
  };
}

function toEvent(row: EventRow): NegotiationEvent {
  return {
    v: 1,
    id: row.id,
    seq: row.seq,
    negotiationId: row.negotiationId,
    ts: row.createdAt.toISOString(),
    audience: row.audience as NegotiationEvent["audience"],
    t: row.type,
    ...row.payload,
  } as NegotiationEvent;
}

/** The stored row keeps the envelope's id and timestamp, so a backfill matches what was published. */
function toEventRow(event: NegotiationEvent): typeof negotiationEvents.$inferInsert {
  const { v: _v, id, ts, negotiationId, seq, audience, t, ...body } = event;
  return {
    id,
    negotiationId,
    seq,
    type: t,
    audience,
    payload: body as Record<string, unknown>,
    createdAt: new Date(ts),
  };
}

export interface SealedRecord {
  negotiationId: string;
  side: Side;
  commitment: string;
  limitCents: number;
  saltHex: string;
  domainCents: number | null;
}

/** Who is writing a step. Agent steps are refused while a human controls the negotiation. */
export type StepActor = "agent" | "human" | "system";

/** An event body; `audience` defaults to "all" (the public stream). */
export type StepBody = EventInput & { audience?: Audience };

export interface StepCommit {
  negotiationId: string;
  /** The seq the first new event must take; null appends at the end. A mismatch writes nothing. */
  expectedSeq: number | null;
  bodies: StepBody[];
  actor: StepActor;
  /** Write nothing when the log already holds an event of this type (once-only events). */
  onceType?: NegotiationEvent["t"];
  patch?: Partial<{
    turns: Turn[];
    agreedPriceCents: number;
    market: MarketRange;
    controlled: boolean;
  }>;
  /** Applied in the same transaction. `required`: write nothing unless the state is in `from`. */
  transition?: { from: NegotiationState[]; to: NegotiationState; required?: boolean };
}

export interface NewBasketLine {
  /** Pre-generated negotiation id: the sealed commitments bind to it. */
  id: string;
  shopItemId: string;
  name: string;
  emoji: string | null;
  unit: string | null;
  qty: number;
  /** The shop's list price per unit (its public opening ask). */
  openCents: number;
  /** The buyer's per-unit ceiling; also sealed in `sealed`. */
  maxCents: number;
  /** The vendor's own floor per unit, snapshotted for the seller's ledger (seller-only). */
  floorCents: number;
  sealed: SealedRecord[];
}

export interface NewBasket {
  buyerUserId: string;
  shopId: string;
  currency: string;
  roundsMax: number;
  tone: string;
  preset: string | null;
  buyerPersona: Persona;
  shopPersona: Persona;
  lines: NewBasketLine[];
}

/**
 * All persistence for MolTol. The engine depends on this shape (a port), the API
 * and worker depend on the concrete class.
 */
export class MoltolStore {
  private readonly sealKey: Buffer | null;

  constructor(
    private readonly db: Db,
    private readonly sql: Sql,
    options: { sealKeyHex?: string | undefined } = {},
  ) {
    this.sealKey = parseSealKey(options.sealKeyHex ?? process.env.SEAL_KEY);
  }

  async ping(): Promise<boolean> {
    await this.sql`SELECT 1`;
    return true;
  }

  /* ------------------------------ negotiations ----------------------------- */

  async createNegotiation(input: CreateNegotiationInput): Promise<Negotiation> {
    const rows = await this.db
      .insert(negotiations)
      .values({
        query: input.query,
        persona: input.persona,
        roundsMax: input.roundsMax,
        maxTotalCents: input.maxTotalCents,
        currency: input.currency,
      })
      .returning();
    return toNegotiation(rows[0]!);
  }

  async getNegotiation(id: string): Promise<Negotiation | null> {
    const rows = await this.db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
    return rows[0] ? toNegotiation(rows[0]) : null;
  }

  /** Conditional transition: only succeeds from the expected state. */
  async transition(id: string, from: NegotiationState, to: NegotiationState): Promise<boolean> {
    const rows = await this.db
      .update(negotiations)
      .set({ state: to, updatedAt: new Date() })
      .where(and(eq(negotiations.id, id), eq(negotiations.state, from)))
      .returning({ id: negotiations.id });
    return rows.length > 0;
  }

  async setPayment(id: string, orderId: string, captureId?: string): Promise<void> {
    await this.db
      .update(negotiations)
      .set({
        paypalOrderId: orderId,
        ...(captureId ? { paypalCaptureId: captureId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(negotiations.id, id));
  }

  /* -------------------------------- events -------------------------------- */

  /**
   * The only way an event enters the log. Serialized per negotiation with an
   * advisory lock, so `seq` is gap-free and two writers (the agent runner and a
   * human taking over) can never interleave or overwrite each other. Returns the
   * written events, or null when the commit was refused (stale `expectedSeq`,
   * agent vs. human control, once-only duplicate, or a required transition).
   */
  async commitStep(c: StepCommit): Promise<NegotiationEvent[] | null> {
    return this.db.transaction(async (tx) => {
      await tx.execute(raw`SELECT pg_advisory_xact_lock(hashtextextended(${c.negotiationId}, 0))`);
      const [row] = await tx
        .select({ state: negotiations.state, controlled: negotiations.controlled })
        .from(negotiations)
        .where(eq(negotiations.id, c.negotiationId))
        .limit(1);
      if (!row) throw new Error(`negotiation ${c.negotiationId} not found`);
      if (c.actor === "agent" && row.controlled) return null;

      const transitionApplies = c.transition
        ? c.transition.from.includes(row.state as NegotiationState)
        : false;
      if (c.transition?.required && !transitionApplies) return null;

      if (c.onceType) {
        const dup = await tx
          .select({ id: negotiationEvents.id })
          .from(negotiationEvents)
          .where(
            and(
              eq(negotiationEvents.negotiationId, c.negotiationId),
              eq(negotiationEvents.type, c.onceType),
            ),
          )
          .limit(1);
        if (dup.length > 0) return null;
      }

      const next = await nextSeqIn(tx, c.negotiationId);
      if (c.expectedSeq !== null && c.expectedSeq !== next) return null;

      const now = new Date();
      const events = c.bodies.map(
        ({ audience, ...body }, i) =>
          ({
            v: 1,
            id: randomUUID(),
            seq: next + i,
            negotiationId: c.negotiationId,
            ts: now.toISOString(),
            audience: audience ?? "all",
            ...body,
          }) as NegotiationEvent,
      );
      if (events.length > 0) await tx.insert(negotiationEvents).values(events.map(toEventRow));

      const set: Partial<typeof negotiations.$inferInsert> = { updatedAt: now, ...c.patch };
      if (transitionApplies) set.state = c.transition!.to;
      await tx.update(negotiations).set(set).where(eq(negotiations.id, c.negotiationId));
      return events;
    });
  }

  /** Append one platform event (payment, proof, timeout) at the end of the log. */
  async appendSystemEvent(
    negotiationId: string,
    body: StepBody,
    options: Pick<StepCommit, "onceType" | "transition"> = {},
  ): Promise<NegotiationEvent | null> {
    const events = await this.commitStep({
      negotiationId,
      expectedSeq: null,
      bodies: [body],
      actor: "system",
      ...options,
    });
    return events?.[0] ?? null;
  }

  async listEvents(negotiationId: string, afterSeq = -1): Promise<NegotiationEvent[]> {
    const rows = await this.db
      .select()
      .from(negotiationEvents)
      .where(
        and(
          eq(negotiationEvents.negotiationId, negotiationId),
          raw`${negotiationEvents.seq} > ${afterSeq}`,
        ),
      )
      .orderBy(asc(negotiationEvents.seq));
    return rows.map(toEvent);
  }

  /* ------------------------------- sealed vault ---------------------------- */

  /** Persist a limit, encrypting it when a SEAL_KEY is configured. */
  private sealedColumns(record: SealedRecord): {
    limitCents: number | null;
    limitEnc: string | null;
  } {
    if (!this.sealKey) return { limitCents: record.limitCents, limitEnc: null };
    const aad = sealAad(record.negotiationId, record.side);
    return { limitCents: null, limitEnc: encryptLimit(record.limitCents, aad, this.sealKey) };
  }

  private sealedRow(record: SealedRecord): typeof sealedSecrets.$inferInsert {
    return {
      negotiationId: record.negotiationId,
      side: record.side,
      commitment: record.commitment,
      saltHex: record.saltHex,
      domainCents: record.domainCents,
      ...this.sealedColumns(record),
    };
  }

  /**
   * Seal a limit, first writer wins. A seal is never replaced: its commitment may
   * already be on the wire, and a second salt would make the proof unverifiable.
   * Callers re-read with `getSealed` to get the record that won.
   */
  async putSealed(record: SealedRecord): Promise<void> {
    await this.db.insert(sealedSecrets).values(this.sealedRow(record)).onConflictDoNothing();
  }

  async getSealed(negotiationId: string, side: Side): Promise<SealedRecord | null> {
    const rows = await this.db
      .select()
      .from(sealedSecrets)
      .where(and(eq(sealedSecrets.negotiationId, negotiationId), eq(sealedSecrets.side, side)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    let limitCents: number;
    if (row.limitEnc) {
      if (!this.sealKey) throw new Error("sealed limit is encrypted but SEAL_KEY is missing");
      limitCents = decryptLimit(row.limitEnc, sealAad(row.negotiationId, row.side), this.sealKey);
    } else if (row.limitCents !== null) {
      limitCents = row.limitCents;
    } else {
      throw new Error("sealed limit row has neither plaintext nor ciphertext");
    }
    return {
      negotiationId: row.negotiationId,
      side: row.side as Side,
      commitment: row.commitment,
      limitCents,
      saltHex: row.saltHex,
      domainCents: row.domainCents,
    };
  }

  /* --------------------------------- baskets -------------------------------- */

  /** Basket + one negotiation per line + both sealed limits per line, atomically. */
  async createBasket(input: NewBasket): Promise<{ basketId: string }> {
    return this.db.transaction(async (tx) => {
      const [basket] = await tx
        .insert(baskets)
        .values({
          buyerUserId: input.buyerUserId,
          shopId: input.shopId,
          currency: input.currency,
          roundsMax: input.roundsMax,
          tone: input.tone,
          preset: input.preset,
        })
        .returning({ id: baskets.id });
      const basketId = basket!.id;
      await tx.insert(negotiations).values(
        input.lines.map((line, i) => ({
          id: line.id,
          query: line.name,
          persona: input.buyerPersona,
          roundsMax: input.roundsMax,
          maxTotalCents: line.maxCents,
          currency: input.currency,
          basketId,
          lineIndex: i,
          shopItemId: line.shopItemId,
          itemEmoji: line.emoji,
          itemUnit: line.unit,
          qty: String(line.qty),
          openCents: line.openCents,
          floorCents: line.floorCents,
          shopPersona: input.shopPersona,
        })),
      );
      await tx
        .insert(sealedSecrets)
        .values(input.lines.flatMap((line) => line.sealed.map((s) => this.sealedRow(s))));
      return { basketId };
    });
  }

  async getBasket(id: string): Promise<BasketRow | null> {
    const rows = await this.db.select().from(baskets).where(eq(baskets.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async listBasketLines(basketId: string): Promise<Negotiation[]> {
    const rows = await this.db
      .select()
      .from(negotiations)
      .where(eq(negotiations.basketId, basketId))
      .orderBy(asc(negotiations.lineIndex));
    return rows.map(toNegotiation);
  }

  async listBasketLinesFor(basketIds: string[]): Promise<Negotiation[]> {
    if (basketIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(negotiations)
      .where(inArray(negotiations.basketId, basketIds))
      .orderBy(asc(negotiations.lineIndex));
    return rows.map(toNegotiation);
  }

  async listBuyerBaskets(buyerUserId: string, limit = 50): Promise<BasketRow[]> {
    return this.db
      .select()
      .from(baskets)
      .where(eq(baskets.buyerUserId, buyerUserId))
      .orderBy(desc(baskets.createdAt))
      .limit(limit);
  }

  async listPaidShopBaskets(shopId: string, since?: Date, limit = 200): Promise<BasketRow[]> {
    return this.db
      .select()
      .from(baskets)
      .where(
        and(
          eq(baskets.shopId, shopId),
          eq(baskets.state, "paid"),
          since ? gte(baskets.paidAt, since) : undefined,
        ),
      )
      .orderBy(desc(baskets.paidAt))
      .limit(limit);
  }

  /** Conditional basket state change; true only for the call that made it. */
  async transitionBasket(id: string, from: string[], to: string): Promise<boolean> {
    const rows = await this.db
      .update(baskets)
      .set({ state: to, updatedAt: new Date() })
      .where(and(eq(baskets.id, id), inArray(baskets.state, from)))
      .returning({ id: baskets.id });
    return rows.length > 0;
  }

  /**
   * Mark a basket paid and take the sold quantities out of stock, once: only
   * the call that flips it to paid touches stock. From "open" too, so a checkout
   * interrupted before the basket moved to payment_pending still settles.
   * Returns the lines that sold more than was left (stock is floored at 0).
   */
  async markBasketPaid(
    basketId: string,
    sold: { shopItemId: string; qty: number }[],
  ): Promise<{ flipped: boolean; oversold: string[] }> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const flipped = await tx
        .update(baskets)
        .set({ state: "paid", paidAt: now, updatedAt: now })
        .where(and(eq(baskets.id, basketId), inArray(baskets.state, ["open", "payment_pending"])))
        .returning({ id: baskets.id });
      if (flipped.length === 0) return { flipped: false, oversold: [] };
      const oversold: string[] = [];
      for (const line of sold) {
        const [item] = await tx
          .select({ quantity: shopItems.quantity })
          .from(shopItems)
          .where(eq(shopItems.id, line.shopItemId))
          .for("update");
        if (!item || item.quantity === null) continue; // stock not tracked (or item deleted)
        if (Number(item.quantity) < line.qty) oversold.push(line.shopItemId);
        await tx
          .update(shopItems)
          .set({
            quantity: raw`GREATEST(${shopItems.quantity} - ${String(line.qty)}::numeric, 0)`,
            updatedAt: now,
          })
          .where(eq(shopItems.id, line.shopItemId));
      }
      return { flipped: true, oversold };
    });
  }

  /* ------------------------------ reservations ----------------------------- */

  /**
   * Hold stock for a basket's closed lines at checkout. Rows are locked in one
   * transaction, so two buyers cannot both claim the last unit; a shortage rolls
   * the whole hold back. Idempotent: an existing hold for the basket succeeds.
   */
  async reserveStock(
    basketId: string,
    lines: { shopItemId: string; qty: number }[],
  ): Promise<{ ok: true } | { ok: false; shortage: { shopItemId: string; available: number }[] }> {
    return this.db.transaction(async (tx) => {
      const held = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(and(eq(reservations.basketId, basketId), isNull(reservations.releasedAt)))
        .limit(1);
      if (held.length > 0) return { ok: true };

      const shortage: { shopItemId: string; available: number }[] = [];
      const toApply: { shopItemId: string; qty: number }[] = [];
      for (const line of lines) {
        const [item] = await tx
          .select({ quantity: shopItems.quantity, reserved: shopItems.reservedQty })
          .from(shopItems)
          .where(eq(shopItems.id, line.shopItemId))
          .for("update");
        if (!item || item.quantity === null) continue; // stock not tracked, or item deleted
        const available = Number(item.quantity) - Number(item.reserved);
        if (available < line.qty) {
          shortage.push({ shopItemId: line.shopItemId, available: Math.max(0, available) });
          continue;
        }
        toApply.push(line);
      }
      if (shortage.length > 0) return { ok: false, shortage };

      const now = new Date();
      for (const line of toApply) {
        await tx
          .update(shopItems)
          .set({
            reservedQty: raw`${shopItems.reservedQty} + ${String(line.qty)}::numeric`,
            updatedAt: now,
          })
          .where(eq(shopItems.id, line.shopItemId));
        await tx
          .insert(reservations)
          .values({ basketId, shopItemId: line.shopItemId, qty: String(line.qty) });
      }
      return { ok: true };
    });
  }

  /** Clear a basket's holds (paid, failed, or expired). Stock itself is untouched. */
  async releaseReservations(basketId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const held = await tx
        .select()
        .from(reservations)
        .where(and(eq(reservations.basketId, basketId), isNull(reservations.releasedAt)));
      if (held.length === 0) return 0;
      const now = new Date();
      for (const r of held) {
        await tx
          .update(shopItems)
          .set({
            reservedQty: raw`GREATEST(${shopItems.reservedQty} - ${String(r.qty)}::numeric, 0)`,
            updatedAt: now,
          })
          .where(eq(shopItems.id, r.shopItemId));
        await tx.update(reservations).set({ releasedAt: now }).where(eq(reservations.id, r.id));
      }
      return held.length;
    });
  }

  /**
   * Release holds older than `ttlMs` whose basket never captured. The sweep runs
   * off the request path (the worker), so an abandoned checkout does not pin stock
   * forever. Returns how many were released.
   */
  async expireReservations(ttlMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - ttlMs);
    return this.db.transaction(async (tx) => {
      const stale = await tx
        .select()
        .from(reservations)
        .where(and(isNull(reservations.releasedAt), lt(reservations.createdAt, cutoff)));
      if (stale.length === 0) return 0;
      const now = new Date();
      let released = 0;
      for (const r of stale) {
        const [b] = await tx
          .select({ state: baskets.state })
          .from(baskets)
          .where(eq(baskets.id, r.basketId))
          .limit(1);
        if (!b || b.state !== "paid") {
          await tx
            .update(shopItems)
            .set({
              reservedQty: raw`GREATEST(${shopItems.reservedQty} - ${String(r.qty)}::numeric, 0)`,
              updatedAt: now,
            })
            .where(eq(shopItems.id, r.shopItemId));
          released += 1;
        }
        await tx.update(reservations).set({ releasedAt: now }).where(eq(reservations.id, r.id));
      }
      return released;
    });
  }

  /* -------------------------------- payments ------------------------------- */

  async createPayment(input: {
    negotiationId?: string | null;
    basketId?: string | null;
    paypalOrderId: string;
    approveUrl?: string | null;
    amountCents: number;
    currency: string;
    dealAmountCents?: number;
    dealCurrency?: string;
    fxRate?: number;
  }): Promise<void> {
    await this.db
      .insert(payments)
      .values({
        negotiationId: input.negotiationId ?? null,
        basketId: input.basketId ?? null,
        paypalOrderId: input.paypalOrderId,
        approveUrl: input.approveUrl ?? null,
        amountCents: input.amountCents,
        currency: input.currency,
        dealAmountCents: input.dealAmountCents ?? null,
        dealCurrency: input.dealCurrency ?? null,
        fxRate: input.fxRate !== undefined ? String(input.fxRate) : null,
      })
      .onConflictDoNothing();
  }

  /**
   * Swap a basket's order for a fresh one (a retry after a denial or expiry).
   * The old order id is dropped so the unique index frees up; a late webhook for
   * it finds no payment row and no-ops.
   */
  async replaceBasketOrder(
    basketId: string,
    order: {
      paypalOrderId: string;
      approveUrl: string | null;
      amountCents: number;
      currency: string;
      dealAmountCents?: number;
      dealCurrency?: string;
      fxRate?: number;
    },
  ): Promise<boolean> {
    const rows = await this.db
      .update(payments)
      .set({
        paypalOrderId: order.paypalOrderId,
        approveUrl: order.approveUrl,
        amountCents: order.amountCents,
        currency: order.currency,
        dealAmountCents: order.dealAmountCents ?? null,
        dealCurrency: order.dealCurrency ?? null,
        fxRate: order.fxRate !== undefined ? String(order.fxRate) : null,
        paypalCaptureId: null,
        status: "order_created",
        updatedAt: new Date(),
      })
      .where(eq(payments.basketId, basketId))
      .returning({ id: payments.id });
    return rows.length > 0;
  }

  async getPaymentByNegotiation(negotiationId: string): Promise<PaymentRow | null> {
    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.negotiationId, negotiationId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getPaymentByBasket(basketId: string): Promise<PaymentRow | null> {
    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.basketId, basketId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getPaymentsByBaskets(basketIds: string[]): Promise<PaymentRow[]> {
    if (basketIds.length === 0) return [];
    return this.db.select().from(payments).where(inArray(payments.basketId, basketIds));
  }

  async getPaymentByOrder(paypalOrderId: string): Promise<PaymentRow | null> {
    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.paypalOrderId, paypalOrderId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Conditional status change. With `onlyFrom`, true only for the call that
   * actually moved it — the idempotency latch for capture/webhook races.
   */
  async setPaymentStatus(
    paypalOrderId: string,
    status: string,
    options: { captureId?: string | null; onlyFrom?: string[] } = {},
  ): Promise<boolean> {
    const rows = await this.db
      .update(payments)
      .set({
        status,
        ...(options.captureId ? { paypalCaptureId: options.captureId } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(payments.paypalOrderId, paypalOrderId),
          options.onlyFrom ? inArray(payments.status, options.onlyFrom) : undefined,
        ),
      )
      .returning({ id: payments.id });
    return rows.length > 0;
  }

  /* -------------------------------- webhooks ------------------------------- */

  /** Returns true if this event id is new (i.e. we own processing it). */
  async recordWebhook(
    id: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const rows = await this.db
      .insert(webhookEvents)
      .values({ id, type, payload })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    return rows.length > 0;
  }

  /** Release a webhook id whose processing failed, so PayPal's retry is not treated as a duplicate. */
  async forgetWebhook(id: string): Promise<void> {
    await this.db.delete(webhookEvents).where(eq(webhookEvents.id, id));
  }

  /* --------------------------------- proofs -------------------------------- */

  async upsertProof(input: {
    negotiationId: string;
    priceCents: number;
    verified: boolean;
    fairness: number;
    buyerSavedCents: number;
    shopGainedCents: number;
    detail: Record<string, unknown>;
  }): Promise<void> {
    await this.db
      .insert(proofs)
      .values({ ...input, verified: String(input.verified) })
      .onConflictDoUpdate({
        target: [proofs.negotiationId],
        set: {
          priceCents: input.priceCents,
          verified: String(input.verified),
          fairness: input.fairness,
          buyerSavedCents: input.buyerSavedCents,
          shopGainedCents: input.shopGainedCents,
          detail: input.detail,
        },
      });
  }

  async getProof(negotiationId: string) {
    const rows = await this.db
      .select()
      .from(proofs)
      .where(eq(proofs.negotiationId, negotiationId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getProofs(negotiationIds: string[]) {
    if (negotiationIds.length === 0) return [];
    return this.db.select().from(proofs).where(inArray(proofs.negotiationId, negotiationIds));
  }

  /* --------------------------------- users --------------------------------- */

  async createUser(input: { email: string; passwordHash: string }): Promise<UserRow> {
    const rows = await this.db
      .insert(users)
      .values({ email: input.email, passwordHash: input.passwordHash })
      .returning();
    return rows[0]!;
  }

  async getUserByEmail(email: string): Promise<UserRow | null> {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0] ?? null;
  }

  async getUserById(id: string): Promise<UserRow | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /** New password; with `revokeSessions`, every token issued before now stops working. */
  async setUserPassword(
    id: string,
    passwordHash: string,
    options: { revokeSessions?: boolean } = {},
  ): Promise<UserRow | null> {
    const rows = await this.db
      .update(users)
      .set({
        passwordHash,
        ...(options.revokeSessions ? { tokenVersion: raw`${users.tokenVersion} + 1` } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async setUserPreferences(
    id: string,
    patch: Partial<{ activeRole: string; hagglePreset: string }>,
  ): Promise<UserRow | null> {
    const rows = await this.db
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /* -------------------------------- OTP codes ------------------------------ */

  /** One active code per user: delete-then-insert instead of accumulating rows. */
  async putOtp(userId: string, purpose: string, codeHash: string, expiresAt: Date): Promise<void> {
    await this.db.delete(otpCodes).where(eq(otpCodes.userId, userId));
    await this.db.insert(otpCodes).values({ userId, purpose, codeHash, expiresAt });
  }

  async getOtp(userId: string) {
    const rows = await this.db
      .select()
      .from(otpCodes)
      .where(eq(otpCodes.userId, userId))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async incrementOtpAttempts(id: string): Promise<void> {
    await this.db
      .update(otpCodes)
      .set({ attempts: raw`${otpCodes.attempts} + 1` })
      .where(eq(otpCodes.id, id));
  }

  /** Consume a code once: true only for the call that consumed it (two parallel verifies can't both win). */
  async consumeOtp(id: string): Promise<boolean> {
    const rows = await this.db
      .update(otpCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(otpCodes.id, id), raw`${otpCodes.consumedAt} IS NULL`))
      .returning({ id: otpCodes.id });
    return rows.length > 0;
  }

  /* --------------------------------- shops ---------------------------------- */

  async createShop(input: {
    userId: string;
    name: string;
    emoji: string;
    persona?: string;
    currency: string;
    lat?: number | null;
    lng?: number | null;
  }): Promise<ShopRow> {
    const rows = await this.db
      .insert(shops)
      .values({
        ...input,
        ...(input.lat != null && input.lng != null ? { locationUpdatedAt: new Date() } : {}),
      })
      .returning();
    return rows[0]!;
  }

  async getShopByUserId(userId: string): Promise<ShopRow | null> {
    const rows = await this.db.select().from(shops).where(eq(shops.userId, userId)).limit(1);
    return rows[0] ?? null;
  }

  async getShopById(id: string): Promise<ShopRow | null> {
    const rows = await this.db.select().from(shops).where(eq(shops.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async updateShop(
    id: string,
    patch: Partial<{
      name: string;
      emoji: string;
      persona: string;
      lat: number | null;
      lng: number | null;
      isOpen: boolean;
      closeAt: Date | null;
      reopenAt: Date | null;
    }>,
  ): Promise<ShopRow | null> {
    const movesPin = patch.lat !== undefined || patch.lng !== undefined;
    const rows = await this.db
      .update(shops)
      .set({
        ...patch,
        ...(movesPin ? { locationUpdatedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(shops.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /** Fast path for a vendor's moving pin (`PATCH /v1/shops/me/location`). */
  async updateShopLocation(
    id: string,
    location: { lat: number; lng: number } | null,
  ): Promise<ShopRow | null> {
    const now = new Date();
    const rows = await this.db
      .update(shops)
      .set({
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
        locationUpdatedAt: location ? now : null,
        updatedAt: now,
      })
      .where(eq(shops.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /** Shops with a location inside a lat/lng box; the caller computes exact distance. */
  async shopsInBox(box: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  }): Promise<ShopRow[]> {
    return this.db
      .select()
      .from(shops)
      .where(
        and(
          isNotNull(shops.lat),
          isNotNull(shops.lng),
          gte(shops.lat, box.minLat),
          lte(shops.lat, box.maxLat),
          gte(shops.lng, box.minLng),
          lte(shops.lng, box.maxLng),
        ),
      )
      .limit(500);
  }

  /**
   * The shop/basket a LINE belongs to, for the seller's deal feed. Null for a
   * standalone negotiation (no shop), so it never enters a shop's feed.
   */
  async lineContext(
    negotiationId: string,
  ): Promise<{ shopId: string; basketId: string; name: string; currency: string } | null> {
    const [row] = await this.db
      .select({
        shopId: baskets.shopId,
        basketId: baskets.id,
        name: negotiations.query,
        currency: negotiations.currency,
      })
      .from(negotiations)
      .innerJoin(baskets, eq(negotiations.basketId, baskets.id))
      .where(eq(negotiations.id, negotiationId))
      .limit(1);
    return row ?? null;
  }

  /** Every basket at a shop (any state), newest first — the deal funnel's denominator. */
  async listShopBaskets(shopId: string, since?: Date, limit = 500) {
    return this.db
      .select()
      .from(baskets)
      .where(and(eq(baskets.shopId, shopId), since ? gte(baskets.createdAt, since) : undefined))
      .orderBy(desc(baskets.createdAt))
      .limit(limit);
  }

  /**
   * The seller's ledger grid: every line of every PAID basket at this shop, with
   * the vendor's snapshotted floor and the revealed proof's fairness. Seller-only.
   */
  async shopLedgerLines(
    shopId: string,
    since?: Date,
    limit = 2000,
  ): Promise<
    {
      negotiationId: string;
      basketId: string;
      ts: Date;
      currency: string;
      itemId: string | null;
      name: string;
      emoji: string | null;
      unit: string | null;
      qty: number;
      unitCents: number | null;
      listCents: number | null;
      floorCents: number | null;
      fairness: number | null;
      verified: boolean;
    }[]
  > {
    const rows = await this.db
      .select({
        negotiationId: negotiations.id,
        basketId: baskets.id,
        ts: baskets.paidAt,
        currency: negotiations.currency,
        itemId: negotiations.shopItemId,
        name: negotiations.query,
        emoji: negotiations.itemEmoji,
        unit: negotiations.itemUnit,
        qty: negotiations.qty,
        unitCents: negotiations.agreedPriceCents,
        listCents: negotiations.openCents,
        floorCents: negotiations.floorCents,
        fairness: proofs.fairness,
        verified: proofs.verified,
      })
      .from(negotiations)
      .innerJoin(baskets, eq(negotiations.basketId, baskets.id))
      .leftJoin(proofs, eq(proofs.negotiationId, negotiations.id))
      .where(
        and(
          eq(baskets.shopId, shopId),
          eq(baskets.state, "paid"),
          since ? gte(baskets.paidAt, since) : undefined,
        ),
      )
      .orderBy(desc(baskets.paidAt))
      .limit(limit);
    return rows.map((r) => ({
      ...r,
      ts: r.ts ?? new Date(0),
      qty: toNumber(r.qty) ?? 1,
      verified: r.verified === "true",
    }));
  }

  async countItemsByShop(shopIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (shopIds.length === 0) return out;
    const rows = await this.db
      .select({ shopId: shopItems.shopId, count: raw<number>`count(*)::int` })
      .from(shopItems)
      .where(inArray(shopItems.shopId, shopIds))
      .groupBy(shopItems.shopId);
    for (const row of rows) out.set(row.shopId, Number(row.count));
    return out;
  }

  /* ------------------------------ shop items --------------------------------- */

  async createShopItem(input: ShopItemInsertInput) {
    const rows = await this.db.insert(shopItems).values(toItemInsertRow(input)).returning();
    return toShopItemRow(rows[0]!);
  }

  /** Same shape as `createShopItem`, one round trip for N rows — used by CSV/bulk import. */
  async bulkCreateShopItems(shopId: string, inputs: Omit<ShopItemInsertInput, "shopId">[]) {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(shopItems)
        .values(inputs.map((input) => toItemInsertRow({ ...input, shopId })))
        .returning();
      return rows.map(toShopItemRow);
    });
  }

  async listShopItems(shopId: string) {
    const rows = await this.db
      .select()
      .from(shopItems)
      .where(eq(shopItems.shopId, shopId))
      .orderBy(asc(shopItems.createdAt));
    return rows.map(toShopItemRow);
  }

  async getShopItem(id: string) {
    const rows = await this.db.select().from(shopItems).where(eq(shopItems.id, id)).limit(1);
    return rows[0] ? toShopItemRow(rows[0]) : null;
  }

  async getShopItems(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(shopItems).where(inArray(shopItems.id, ids));
    return rows.map(toShopItemRow);
  }

  async updateShopItem(
    id: string,
    patch: Partial<{
      name: string;
      emoji: string | null;
      sellCents: number;
      floorCents: number;
      costCents: number | null;
      category: string | null;
      lowStockAt: number | null;
      quantity: number | null;
      unit: string | null;
      customUnit: string | null;
      packSize: number | null;
      hindiName: string | null;
      archived: boolean;
    }>,
  ) {
    const { quantity, lowStockAt, packSize, ...rest } = patch;
    const rows = await this.db
      .update(shopItems)
      .set({
        ...rest,
        ...(quantity !== undefined
          ? { quantity: quantity === null ? null : String(quantity) }
          : {}),
        ...(lowStockAt !== undefined
          ? { lowStockAt: lowStockAt === null ? "0" : String(lowStockAt) }
          : {}),
        ...(packSize !== undefined
          ? { packSize: packSize === null ? null : String(packSize) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(shopItems.id, id))
      .returning();
    return rows[0] ? toShopItemRow(rows[0]) : null;
  }

  async deleteShopItem(id: string) {
    const rows = await this.db
      .update(shopItems)
      .set({ archived: true, updatedAt: new Date() })
      .where(eq(shopItems.id, id))
      .returning();
    return rows[0] ? toShopItemRow(rows[0]) : null;
  }

  async adjustShopItemStock(
    shopId: string,
    itemId: string,
    delta: number,
    reason: string | undefined,
    opId: string | undefined,
  ): Promise<ShopItemRow | "conflict" | null> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.select().from(shopItems).where(eq(shopItems.id, itemId)).limit(1);
      if (existing.length === 0) return null;
      const row = existing[0]!;
      if (row.shopId !== shopId) return null;
      if (opId) {
        const dup = await tx
          .select({ id: stockAdjustments.id })
          .from(stockAdjustments)
          .where(and(eq(stockAdjustments.shopItemId, itemId), eq(stockAdjustments.opId, opId)))
          .limit(1);
        if (dup.length > 0) return "conflict";
      }
      const current = row.quantity === null ? null : Number(row.quantity);
      const next = current === null ? String(delta) : String(current + delta);
      const updated = await tx
        .update(shopItems)
        .set({ quantity: next, updatedAt: new Date() })
        .where(eq(shopItems.id, itemId))
        .returning();
      try {
        await tx.insert(stockAdjustments).values({
          shopItemId: itemId,
          delta: String(delta),
          reason: reason ?? null,
          opId: opId ?? null,
        });
      } catch {
        // ignore duplicate inserts on retry
      }
      return toShopItemRow(updated[0]!);
    });
  }

  /* -------------------------------- sweeper -------------------------------- */

  async staleNegotiations(
    before: Date,
    states: NegotiationState[],
    options: { controlled?: boolean } = {},
  ): Promise<string[]> {
    const rows = await this.db
      .select({ id: negotiations.id })
      .from(negotiations)
      .where(
        and(
          inArray(negotiations.state, states),
          lt(negotiations.updatedAt, before),
          options.controlled === undefined
            ? undefined
            : eq(negotiations.controlled, options.controlled),
        ),
      );
    return rows.map((r) => r.id);
  }
}

export type ShopItemRow = ReturnType<typeof toShopItemRow>;

function toShopItemRow(row: typeof shopItems.$inferSelect) {
  return { ...row, quantity: toNumber(row.quantity) };
}

export interface ShopItemInsertInput {
  shopId: string;
  name: string;
  emoji?: string;
  sellCents: number;
  floorCents: number;
  costCents?: number | null;
  category?: string | null;
  lowStockAt?: number | null;
  quantity?: number | null;
  unit?: string | null;
  customUnit?: string | null;
  packSize?: number | null;
  hindiName?: string | null;
  archived?: boolean;
}

function toItemInsertRow(input: ShopItemInsertInput) {
  const { quantity, lowStockAt, packSize, ...rest } = input;
  return {
    ...rest,
    ...(quantity !== undefined && quantity !== null ? { quantity: String(quantity) } : {}),
    ...(lowStockAt !== undefined && lowStockAt !== null ? { lowStockAt: String(lowStockAt) } : {}),
    ...(packSize !== undefined ? { packSize: packSize === null ? null : String(packSize) } : {}),
  };
}

async function nextSeqIn(tx: Tx, negotiationId: string): Promise<number> {
  const rows = await tx
    .select({ max: raw<number | null>`max(${negotiationEvents.seq})` })
    .from(negotiationEvents)
    .where(eq(negotiationEvents.negotiationId, negotiationId));
  const max = rows[0]?.max;
  return max === null || max === undefined ? 0 : Number(max) + 1;
}
