import { randomUUID } from "node:crypto";
import type { CreateNegotiationInput, Negotiation, Turn } from "@moltol/contracts";
import type { Sql } from "./db";

export class NegotiationStore {
  constructor(private readonly sql: Sql) {}

  async ensureSchema(): Promise<void> {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
    await this.sql.unsafe(schema);
  }

  async create(input: CreateNegotiationInput): Promise<Negotiation> {
    const id = randomUUID();
    const rows = await this.sql<Negotiation[]>`
      INSERT INTO negotiations (id, state, query, persona, rounds_max, max_total_cents, currency)
      VALUES (${id}, 'init', ${input.query}, ${input.persona}, ${input.roundsMax},
              ${input.maxTotalCents}, ${input.currency})
      RETURNING id, state, query, persona,
                rounds_max AS "roundsMax", max_total_cents AS "maxTotalCents",
                currency, agreed_price_cents AS "agreedPriceCents",
                paypal_order_id AS "paypalOrderId", market,
                turns, created_at AS "createdAt"
    `;
    return rows[0]!;
  }

  async get(id: string): Promise<Negotiation | null> {
    const rows = await this.sql<Negotiation[]>`
      SELECT id, state, query, persona,
             rounds_max AS "roundsMax", max_total_cents AS "maxTotalCents",
             currency, agreed_price_cents AS "agreedPriceCents",
             paypal_order_id AS "paypalOrderId", market,
             turns, created_at AS "createdAt"
      FROM negotiations WHERE id = ${id}
    `;
    return rows[0] ?? null;
  }

  async appendTurn(id: string, turn: Turn): Promise<void> {
    const current = await this.get(id);
    if (!current) throw new Error(`negotiation ${id} not found`);
    const turns = [...current.turns, turn];
    await this.sql`
      UPDATE negotiations SET turns = ${this.sql.json(turns)} WHERE id = ${id}
    `;
  }
}
