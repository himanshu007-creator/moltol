import type { FastifyInstance } from "fastify";
import {
  formatCents,
  LedgerAskRequestSchema,
  LedgerPeriodSchema,
  BuyerInsightsQuerySchema,
  type LedgerAnswer,
  type Negotiation,
  type LedgerRow,
} from "@moltol/contracts";
import { createLedgerAgent, type ExternalFacts } from "@moltol/llm";
import { createPayPalReporting } from "@moltol/paypal";
import type { PaymentRow } from "@moltol/store";
import { computeBuyerInsights, computeLedger, toLedgerRow, windowFor } from "./ledger";
import type { Container } from "./container";
import { invalidBody, sendProblem } from "./http";

/** A per-line proof lookup, keyed by negotiation id (proofs store `verified` as text). */
function proofIndex(
  proofs: { negotiationId: string; fairness: number | null; verified: string }[],
) {
  return new Map(
    proofs.map((p) => [p.negotiationId, { fairness: p.fairness, verified: p.verified === "true" }]),
  );
}

export async function registerLedgerRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  const { store, env } = container;
  const auth = { preHandler: [app.authenticate] };

  const llm = { baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL };
  // Best-effort PayPal-side facts for the Ledger Agent; the ledger stands alone without them.
  const reporting =
    env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET
      ? createPayPalReporting({
          env: env.PAYPAL_ENV,
          clientId: env.PAYPAL_CLIENT_ID,
          clientSecret: env.PAYPAL_CLIENT_SECRET,
        })
      : null;

  /* ------------------------- GET /v1/ledger (grid) ------------------------- */

  app.get<{ Querystring: { period?: string } }>("/v1/ledger", auth, async (req, reply) => {
    const shop = await store.getShopByUserId(req.user.sub);
    if (!shop) return sendProblem(reply, 404, "no_shop", "Create a shop first.");
    const parsed = LedgerPeriodSchema.safeParse(req.query.period ?? "30d");
    if (!parsed.success) return sendProblem(reply, 400, "invalid_period");
    const window = windowFor(parsed.data);
    const since = window.from ? new Date(window.from) : undefined;

    const [lines, baskets] = await Promise.all([
      store.shopLedgerLines(shop.id, since),
      store.listShopBaskets(shop.id, since),
    ]);
    const allLines = await store.listBasketLinesFor(baskets.map((b) => b.id));
    const ledger = computeLedger({ window, currency: shop.currency, lines, baskets, allLines });
    return reply.send(ledger);
  });

  /* ---------------------- GET /v1/ledger/summary (KPIs) --------------------- */

  app.get<{ Querystring: { period?: string } }>("/v1/ledger/summary", auth, async (req, reply) => {
    const shop = await store.getShopByUserId(req.user.sub);
    if (!shop) return sendProblem(reply, 404, "no_shop", "Create a shop first.");
    const parsed = LedgerPeriodSchema.safeParse(req.query.period ?? "30d");
    if (!parsed.success) return sendProblem(reply, 400, "invalid_period");
    const window = windowFor(parsed.data);
    const since = window.from ? new Date(window.from) : undefined;
    const [lines, baskets] = await Promise.all([
      store.shopLedgerLines(shop.id, since),
      store.listShopBaskets(shop.id, since),
    ]);
    const allLines = await store.listBasketLinesFor(baskets.map((b) => b.id));
    const ledger = computeLedger({ window, currency: shop.currency, lines, baskets, allLines });
    return reply.send({ window, currency: shop.currency, kpis: ledger.kpis });
  });

  /* ----------------------- POST /v1/ledger/ask (agent) ---------------------- */

  app.post("/v1/ledger/ask", auth, async (req, reply) => {
    const shop = await store.getShopByUserId(req.user.sub);
    if (!shop) return sendProblem(reply, 404, "no_shop", "Create a shop first.");
    const parsed = LedgerAskRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(reply, parsed.error);
    const window = windowFor(parsed.data.period);
    const since = window.from ? new Date(window.from) : undefined;

    const [lines, baskets] = await Promise.all([
      store.shopLedgerLines(shop.id, since),
      store.listShopBaskets(shop.id, since),
    ]);
    const allLines = await store.listBasketLinesFor(baskets.map((b) => b.id));
    const ledger = computeLedger({ window, currency: shop.currency, lines, baskets, allLines });

    const externalFacts: ExternalFacts | undefined = reporting
      ? async () => {
          const from = window.from
            ? new Date(window.from)
            : new Date(new Date(window.to).getTime() - 90 * 24 * 60 * 60 * 1000);
          const insights = await reporting.getMerchantInsights({ from, to: new Date(window.to) });
          if (!insights) return [];
          return [
            {
              label: "paypal",
              text: `PayPal reports ${insights.transactionCount} transactions, gross ${formatCents(
                insights.grossCents ?? 0,
                insights.currency ?? shop.currency,
              )}`,
            },
          ];
        }
      : undefined;

    const agent = createLedgerAgent(
      {
        window: ledger.window,
        currency: ledger.currency,
        kpis: ledger.kpis,
        widgets: ledger.widgets,
        rows: ledger.rows,
      },
      llm,
      externalFacts ? { externalFacts } : {},
    );
    const result = await agent.ask(parsed.data.question);
    const answer: LedgerAnswer = { ...result, window: ledger.window };
    return reply.send(answer);
  });

  /* -------------------- GET /v1/insights/buyer (buyer cards) ---------------- */

  app.get<{ Querystring: { budgetCents?: string } }>(
    "/v1/insights/buyer",
    auth,
    async (req, reply) => {
      const parsed = BuyerInsightsQuerySchema.safeParse(req.query);
      if (!parsed.success) return invalidBody(reply, parsed.error);

      const baskets = await store.listBuyerBaskets(req.user.sub);
      const payments = await store.getPaymentsByBaskets(baskets.map((b) => b.id));
      const paidByBasket = new Map<string, PaymentRow>();
      for (const p of payments) if (p.basketId) paidByBasket.set(p.basketId, p);

      const orders = baskets.filter((b) => paidByBasket.has(b.id));
      const lines = await store.listBasketLinesFor(orders.map((b) => b.id));
      const proofs = proofIndex(await store.getProofs(lines.map((l) => l.id)));

      const linesByBasket = new Map<string, Negotiation[]>();
      for (const line of lines) {
        if (!line.basketId) continue;
        const bucket = linesByBasket.get(line.basketId) ?? [];
        bucket.push(line);
        linesByBasket.set(line.basketId, bucket);
      }

      const currency = orders[0]?.currency ?? env.DEFAULT_CURRENCY;
      const toRow = (line: Negotiation): LedgerRow => {
        const proof = proofs.get(line.id);
        return toLedgerRow({
          negotiationId: line.id,
          basketId: line.basketId!,
          ts: new Date(line.createdAt),
          currency: line.currency,
          itemId: line.shopItemId,
          name: line.query,
          emoji: line.itemEmoji,
          unit: line.itemUnit,
          qty: line.qty ?? 1,
          unitCents: line.agreedPriceCents,
          listCents: line.openCents,
          floorCents: null,
          fairness: proof?.fairness ?? null,
          verified: proof?.verified ?? false,
        });
      };

      const insights = computeBuyerInsights({
        currency,
        budgetCents: parsed.data.budgetCents ?? null,
        orders: orders.map((b) => ({
          ts: b.paidAt ? new Date(b.paidAt) : new Date(b.createdAt),
          shopId: b.shopId,
          lines: (linesByBasket.get(b.id) ?? []).map(toRow),
        })),
      });
      return reply.send(insights);
    },
  );
}
