import { z } from "zod";
import type { TurnContext, TurnGenerator } from "@moltol/engine";
import { cannedTurn } from "./fallback";

const ReplySchema = z.object({
  priceCents: z.number().int().nonnegative(),
  message: z.string().min(1).max(600),
  tactic: z
    .enum([
      "anchor",
      "bundle",
      "free-delivery",
      "walk-away-bluff",
      "loyalty",
      "market-cite",
      "final-offer",
      "plain",
    ])
    .optional(),
});

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

/**
 * The system prompt deliberately contains NO sealed limits — only public
 * information (persona, market comps, history, and the policy price the model may
 * nudge within the band). See AGENTS.md invariant #2.
 */
function buildMessages(ctx: TurnContext) {
  const historyLines = ctx.history
    .map(
      (h) =>
        `${h.actor}: ${h.priceCents !== undefined ? `$${(h.priceCents / 100).toFixed(2)}` : "—"} (${h.message})`,
    )
    .join("\n");
  return [
    {
      role: "system" as const,
      content:
        "You are an agent in a price negotiation. You never decide the final number: " +
        "the policy engine proposes a price and you may only NUDGE it by at most 3%. " +
        'Reply with strict JSON: {"priceCents":int,"message":string,"tactic":string}. ' +
        "The message should be one or two sentences in the requested persona's voice. " +
        "Never invent or mention any private limit or floor.",
    },
    {
      role: "user" as const,
      content: [
        `You are the ${ctx.actor}. Persona: ${ctx.persona}. Round ${ctx.round + 1}/${ctx.roundsMax}.`,
        `Market: median $${(ctx.market.medianCents / 100).toFixed(2)}, p25 $${(ctx.market.p25Cents / 100).toFixed(2)}, p75 $${(ctx.market.p75Cents / 100).toFixed(2)}.`,
        `Policy price for your turn: ${ctx.policyPriceCents} cents. Stay within ±3%.`,
        ctx.opponentLastPriceCents !== undefined
          ? `Opponent's last price: ${ctx.opponentLastPriceCents} cents.`
          : "You open the negotiation.",
        historyLines ? `History:\n${historyLines}` : "No turns yet.",
      ].join("\n"),
    },
  ];
}

/** OpenAI-compatible chat adapter. Any failure bubbles up; the engine falls back. */
export function createLlmTurnGenerator(config: LlmConfig): TurnGenerator {
  return {
    async generate(ctx: TurnContext) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 8000);
      try {
        const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0.7,
            response_format: { type: "json_object" },
            messages: buildMessages(ctx),
          }),
          signal: controller.signal,
        });
        if (!res.ok) return cannedTurn(ctx);
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const content = json.choices?.[0]?.message?.content;
        if (!content) return cannedTurn(ctx);
        const parsed = ReplySchema.safeParse(JSON.parse(content));
        if (!parsed.success) return cannedTurn(ctx);
        return {
          priceCents: parsed.data.priceCents,
          message: parsed.data.message,
          ...(parsed.data.tactic ? { tactic: parsed.data.tactic } : {}),
        };
      } catch {
        return cannedTurn(ctx);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
