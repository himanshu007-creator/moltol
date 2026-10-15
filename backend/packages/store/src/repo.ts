import { randomUUID } from "node:crypto";
import type {
  CreateNegotiationInput,
  EventInput,
  MarketRange,
  Negotiation,
  NegotiationEvent,
  NegotiationState,
  Persona,
  Side,
} from "@moltol/contracts";
import { sealAad } from "@moltol/config";
import { and, asc, desc, eq, inArray, lt, sql as raw } from "drizzle-orm";
import type { Db, Sql } from "./client";
import { decryptLimit, encryptLimit, parseSealKey } from "./seal";
import {
  negotiations,
  negotiationEvents,
  otpCodes,
  payments,
  proofs,
  sealedSecrets,
  shopItems,
  shops,
  users,
  webhookEvents,
} from "./schema";

type NegotiationRow = typeof negotiations.$inferSelect;

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
    createdAt: row.createdAt.toISOString(),
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

  async setAgreed(
    id: string,
    priceCents: number,
    market: MarketRange | null,
    turns: Negotiation["turns"],
  ): Promise<void> {
    await this.db
      .update(negotiations)
      .set({ agreedPriceCents: priceCents, market, turns, updatedAt: new Date() })
      .where(eq(negotiations.id, id));
  }

  async setTurns(id: string, turns: Negotiation["turns"]): Promise<void> {
    await this.db
      .update(negotiations)
      .set({ turns, updatedAt: new Date() })
      .where(eq(negotiations.id, id));
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

  async nextSeq(negotiationId: string): Promise<number> {
    const rows = await this.db
      .select({ max: raw<number | null>`max(${negotiationEvents.seq})` })
      .from(negotiationEvents)
      .where(eq(negotiationEvents.negotiationId, negotiationId));
    const max = rows[0]?.max ?? null;
    return max === null ? 0 : max + 1;
  }

  async appendEvent(event: NegotiationEvent): Promise<void> {
    const { v: _v, id: _id, ts: _ts, negotiationId, seq, audience, t, ...body } = event;
    await this.db
      .insert(negotiationEvents)
      .values({ negotiationId, seq, type: t, audience, payload: body as Record<string, unknown> })
      .onConflictDoNothing();
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
    return rows.map(
      (row) =>
        ({
          v: 1,
          id: row.id,
          seq: row.seq,
          negotiationId: row.negotiationId,
          ts: row.createdAt.toISOString(),
          audience: row.audience as NegotiationEvent["audience"],
          t: row.type,
          ...(row.payload as Record<string, unknown>),
        }) as NegotiationEvent,
    );
  }

  /** Build a full event envelope from a producer's body. */
  makeEvent(negotiationId: string, seq: number, body: EventInput): NegotiationEvent {
    return {
      v: 1,
      id: randomUUID(),
      seq,
      negotiationId,
      ts: new Date().toISOString(),
      audience: "all",
      ...body,
    } as NegotiationEvent;
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

  async putSealed(record: SealedRecord): Promise<void> {
    const limit = this.sealedColumns(record);
    await this.db
      .insert(sealedSecrets)
      .values({ ...record, ...limit })
      .onConflictDoUpdate({
        target: [sealedSecrets.negotiationId, sealedSecrets.side],
        set: {
          commitment: record.commitment,
          ...limit,
          saltHex: record.saltHex,
          domainCents: record.domainCents,
        },
      });
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

  /* -------------------------------- payments ------------------------------- */

  async createPayment(input: {
    negotiationId: string;
    paypalOrderId: string;
    amountCents: number;
    currency: string;
  }): Promise<void> {
    await this.db.insert(payments).values(input).onConflictDoNothing();
  }

  async getPaymentByNegotiation(negotiationId: string) {
    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.negotiationId, negotiationId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getPaymentByOrder(paypalOrderId: string) {
    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.paypalOrderId, paypalOrderId))
      .limit(1);
    return rows[0] ?? null;
  }

  async updatePaymentStatus(
    paypalOrderId: string,
    status: string,
    captureId?: string,
  ): Promise<void> {
    await this.db
      .update(payments)
      .set({ status, ...(captureId ? { paypalCaptureId: captureId } : {}), updatedAt: new Date() })
      .where(eq(payments.paypalOrderId, paypalOrderId));
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

  /* --------------------------------- users --------------------------------- */

  async createUser(input: { email: string; passwordHash: string }) {
    const rows = await this.db
      .insert(users)
      .values({ email: input.email, passwordHash: input.passwordHash })
      .returning();
    return rows[0]!;
  }

  async getUserByEmail(email: string) {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0] ?? null;
  }

  async getUserById(id: string) {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async setUserPassword(id: string, passwordHash: string): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id));
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

  async consumeOtp(id: string): Promise<void> {
    await this.db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, id));
  }

  /* --------------------------------- shops ---------------------------------- */

  async createShop(input: { userId: string; name: string; emoji: string }) {
    const rows = await this.db.insert(shops).values(input).returning();
    return rows[0]!;
  }

  async getShopByUserId(userId: string) {
    const rows = await this.db.select().from(shops).where(eq(shops.userId, userId)).limit(1);
    return rows[0] ?? null;
  }

  async getShopById(id: string) {
    const rows = await this.db.select().from(shops).where(eq(shops.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /* ------------------------------ shop items --------------------------------- */

  async createShopItem(input: {
    shopId: string;
    name: string;
    emoji?: string;
    sellCents: number;
    floorCents: number;
    quantity?: number;
    unit?: string;
    hindiName?: string;
  }) {
    const rows = await this.db.insert(shopItems).values(input).returning();
    return rows[0]!;
  }

  async listShopItems(shopId: string) {
    return this.db.select().from(shopItems).where(eq(shopItems.shopId, shopId));
  }

  async getShopItem(id: string) {
    const rows = await this.db.select().from(shopItems).where(eq(shopItems.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async updateShopItem(
    id: string,
    patch: Partial<{
      name: string;
      emoji: string | null;
      sellCents: number;
      floorCents: number;
      quantity: number | null;
      unit: string | null;
      hindiName: string | null;
    }>,
  ) {
    const rows = await this.db
      .update(shopItems)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(shopItems.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async deleteShopItem(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(shopItems)
      .where(eq(shopItems.id, id))
      .returning({ id: shopItems.id });
    return rows.length > 0;
  }

  /* -------------------------------- sweeper -------------------------------- */

  async staleNegotiations(before: Date, states: NegotiationState[]): Promise<string[]> {
    const rows = await this.db
      .select({ id: negotiations.id })
      .from(negotiations)
      .where(and(inArray(negotiations.state, states), lt(negotiations.updatedAt, before)));
    return rows.map((r) => r.id);
  }
}
