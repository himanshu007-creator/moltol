import { formatCents } from "@moltol/contracts";
import type { Ledger, LedgerKpis, LedgerRow, LedgerWidgets, LedgerWindow } from "@moltol/contracts";
import type { LlmConfig } from "./provider";

/**
 * The Ledger Agent answers a seller's plain-English questions about their own
 * ledger. It is strictly grounded: the same numbers the grid shows are handed to
 * the model as facts, and it may only cite them. Without an LLM it degrades to a
 * deterministic keyword answer over those same facts — never a blank screen.
 */

export interface LedgerAgentContext {
  window: LedgerWindow;
  currency: string;
  kpis: LedgerKpis;
  widgets: LedgerWidgets;
  rows: LedgerRow[];
}

export interface LedgerAnswerResult {
  answer: string;
  source: "hybrid" | "heuristic";
  facts: string[];
}

export interface LedgerAgent {
  ask(question: string): Promise<LedgerAnswerResult>;
}

/** A flat, labelled view of the ledger the agent (and the model) reasons over. */
export function ledgerFacts(ctx: LedgerAgentContext): { label: string; text: string }[] {
  const money = (c: number) => formatCents(c, ctx.currency);
  const { kpis, widgets } = ctx;
  const facts: { label: string; text: string }[] = [
    {
      label: "deals",
      text: `${kpis.deals.total} deals, ${kpis.deals.won} won (${kpis.deals.winRatePct}%)`,
    },
    {
      label: "revenue",
      text: `Taken ${money(kpis.revenueCents)} against ${money(kpis.listCents)} of sticker`,
    },
    {
      label: "savings",
      text: `${money(kpis.savingsGivenCents)} given away, ${kpis.avgDiscountPct}% average discount`,
    },
    { label: "margin", text: `Margin kept ${money(kpis.marginKeptCents)}` },
    { label: "units", text: `${kpis.unitsSold} units sold` },
  ];
  if (kpis.avgFairness !== null) {
    facts.push({ label: "fairness", text: `Average fairness ${kpis.avgFairness}/100` });
  }
  facts.push({
    label: "proofs",
    text: `${kpis.proofVerifiedRatePct}% of won lines have a verified proof`,
  });
  const topMargin = widgets.marginByItem[0];
  if (topMargin)
    facts.push({
      label: "top-margin-item",
      text: `${topMargin.label}: ${money(topMargin.valueCents)} margin across ${topMargin.count} deals`,
    });
  const topRevenue = widgets.revenueByItem[0];
  if (topRevenue)
    facts.push({
      label: "top-revenue-item",
      text: `${topRevenue.label}: ${money(topRevenue.valueCents)} revenue`,
    });
  const funnel = widgets.dealFunnel.map((s) => `${s.label} ${s.count}`).join(", ");
  facts.push({ label: "funnel", text: `Funnel — ${funnel}` });
  return facts;
}

function summarise(ctx: LedgerAgentContext): string {
  const money = (c: number) => formatCents(c, ctx.currency);
  const { kpis } = ctx;
  if (kpis.deals.total === 0) {
    return "No paid deals in this window yet. Once a basket is paid, its haggled lines show up here with the margin you kept.";
  }
  return (
    `${kpis.deals.won}/${kpis.deals.total} deals closed (${kpis.deals.winRatePct}%) for ${money(kpis.revenueCents)}. ` +
    `You gave away ${money(kpis.savingsGivenCents)} (${kpis.avgDiscountPct}% average) and kept ${money(kpis.marginKeptCents)} over your floors.`
  );
}

/**
 * Deterministic answers when no LLM is configured. It matches the question's
 * intent to the strongest relevant fact, so the demo always says something true.
 */
export function heuristicAnswer(ctx: LedgerAgentContext, question: string): string {
  const q = question.toLowerCase();
  const money = (c: number) => formatCents(c, ctx.currency);
  const { kpis, widgets } = ctx;
  const has = (...words: string[]) => words.some((w) => q.includes(w));

  if (kpis.deals.total === 0) return summarise(ctx);
  if (has("margin", "profit", "kept", "floor")) {
    const top = widgets.marginByItem[0];
    return (
      `You kept ${money(kpis.marginKeptCents)} over your floors` +
      (top ? `, led by ${top.label} at ${money(top.valueCents)}.` : ".")
    );
  }
  if (has("revenue", "sales", "earn", "sold", "turnover")) {
    const top = widgets.revenueByItem[0];
    return (
      `Revenue taken is ${money(kpis.revenueCents)} on ${kpis.unitsSold} units` +
      (top ? `; ${top.label} is your top seller at ${money(top.valueCents)}.` : ".")
    );
  }
  if (has("discount", "gave", "gave away", "saving", "cheap")) {
    return `You gave away ${money(kpis.savingsGivenCents)} off sticker — ${kpis.avgDiscountPct}% on average.`;
  }
  if (has("fair", "fairness")) {
    return kpis.avgFairness === null
      ? "No revealed proofs in this window, so there is no fairness score yet."
      : `Average proof fairness is ${kpis.avgFairness}/100 across won deals.`;
  }
  if (has("proof", "verif")) {
    return `${kpis.proofVerifiedRatePct}% of your won lines carry a verified proof.`;
  }
  if (has("funnel", "drop", "checkout", "convert", "lost")) {
    const f = widgets.dealFunnel;
    return `Funnel: ${f.map((s) => `${s.label.toLowerCase()} ${s.count}`).join(" → ")}.`;
  }
  if (has("win", "rate", "close")) {
    return `Win rate is ${kpis.deals.winRatePct}% — ${kpis.deals.won} won of ${kpis.deals.total}.`;
  }
  if (has("item", "best", "top", "popular")) {
    const top = widgets.revenueByItem[0];
    return top
      ? `${top.label} leads on revenue at ${money(top.valueCents)} (${top.count} deals).`
      : summarise(ctx);
  }
  return summarise(ctx);
}

const SYSTEM =
  "You are the Ledger Agent for a small shop on MolTol. Answer the seller's question " +
  "in two sentences or fewer, using ONLY the facts provided. Quote the exact numbers. " +
  "If the facts do not answer the question, say so plainly. Reply as strict JSON: " +
  '{"answer": string, "facts": string[]} where facts lists the fact labels you used.';

/**
 * Extra facts the agent may cite but does not own — e.g. PayPal transaction
 * search results. Injected so `@moltol/llm` stays free of a PayPal dependency.
 */
export type ExternalFacts = () => Promise<{ label: string; text: string }[]>;

/** Create the agent. With an LLM configured it answers "hybrid", else "heuristic". */
export function createLedgerAgent(
  ctx: LedgerAgentContext,
  config: Partial<LlmConfig> = {},
  opts: { externalFacts?: ExternalFacts } = {},
): LedgerAgent {
  const localFacts = ledgerFacts(ctx);
  const canUseLlm = Boolean(config.baseUrl && config.apiKey && config.model);

  async function gather(): Promise<{ label: string; text: string }[]> {
    if (!opts.externalFacts) return localFacts;
    try {
      return [...localFacts, ...(await opts.externalFacts())];
    } catch {
      return localFacts;
    }
  }

  async function hybrid(
    question: string,
    facts: { label: string; text: string }[],
  ): Promise<LedgerAnswerResult | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 8000);
    try {
      const res = await fetch(`${config.baseUrl!.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content: [
                `Question: ${question}`,
                `Window: ${ctx.window.period}${ctx.window.from ? ` (from ${ctx.window.from})` : ""}`,
                "Facts:",
                ...facts.map((f) => `- [${f.label}] ${f.text}`),
              ].join("\n"),
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content;
      if (!content) return null;
      const parsed = JSON.parse(content) as { answer?: unknown; facts?: unknown };
      if (typeof parsed.answer !== "string" || parsed.answer.trim() === "") return null;
      const cited = Array.isArray(parsed.facts)
        ? parsed.facts.filter(
            (f): f is string => typeof f === "string" && facts.some((x) => x.label === f),
          )
        : [];
      return { answer: parsed.answer.trim(), source: "hybrid", facts: cited };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async ask(question) {
      if (canUseLlm) {
        const facts = await gather();
        const viaLlm = await hybrid(question, facts);
        if (viaLlm) return viaLlm;
      }
      return { answer: heuristicAnswer(ctx, question), source: "heuristic", facts: [] };
    },
  };
}
