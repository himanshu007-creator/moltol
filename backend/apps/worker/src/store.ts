import postgres from "postgres";
import type { Negotiation, Turn } from "@moltol/contracts";

export type Sql = ReturnType<typeof postgres>;

export function createDb(databaseUrl: string): Sql {
  return postgres(databaseUrl, { max: 5, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
}

export async function loadNegotiation(sql: Sql, id: string): Promise<Negotiation | null> {
  const rows = await sql<Negotiation[]>`
    SELECT id, state, query, persona,
           rounds_max AS "roundsMax", max_total_cents AS "maxTotalCents",
           currency, agreed_price_cents AS "agreedPriceCents",
           paypal_order_id AS "paypalOrderId", market,
           turns, created_at AS "createdAt"
    FROM negotiations WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function saveResult(
  sql: Sql,
  id: string,
  turns: Turn[],
  state: "agreed" | "no_deal",
  agreedPriceCents: number | null,
): Promise<void> {
  await sql`
    UPDATE negotiations
    SET turns = ${sql.json(turns)},
        state = ${state},
        agreed_price_cents = ${agreedPriceCents}
    WHERE id = ${id}
  `;
}
