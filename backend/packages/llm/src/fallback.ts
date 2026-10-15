import type { TurnContext, TurnGenerator, TurnSuggestion } from "@moltol/engine";
import { formatCents, type Tactic } from "@moltol/contracts";

const TACTICS: Tactic[] = [
  "anchor",
  "bundle",
  "free-delivery",
  "walk-away-bluff",
  "loyalty",
  "market-cite",
  "final-offer",
  "plain",
];

const TONE: Record<string, string> = {
  charmer: "warm and playful",
  stoic: "terse and unbothered",
  storyteller: "chatty, with a little color",
  analyst: "precise and numbers-first",
};

/**
 * Offline, deterministic narrator. It never sees a sealed limit. On the opening
 * turn it deliberately proposes a price well outside the guard band, so the
 * demo always shows the guard rejecting a greedy suggestion and falling back.
 */
export function cannedTurn(ctx: TurnContext): TurnSuggestion {
  const money = (cents: number) => formatCents(cents, ctx.currency);
  const personaNote = TONE[ctx.persona] ?? "neutral";
  if (ctx.actor === "buyer" && ctx.round === 0) {
    return {
      priceCents: Math.round(ctx.policyPriceCents * 0.7),
      message: `Let's start at ${money(Math.round(ctx.policyPriceCents * 0.7))} — call it a goodwill price.`,
      tactic: "anchor",
    };
  }
  if (ctx.actor === "buyer") {
    const cite = ctx.market.medianCents;
    return {
      priceCents: ctx.policyPriceCents,
      message: `I'm seeing these around ${money(cite)} elsewhere, so ${money(ctx.policyPriceCents)} works for me (${personaNote}).`,
      tactic: "market-cite",
    };
  }
  return {
    priceCents: ctx.policyPriceCents,
    message: `Best I can do is ${money(ctx.policyPriceCents)} — it's already tight at that.`,
    tactic: ctx.round >= ctx.roundsMax - 2 ? "final-offer" : "loyalty",
  };
}

export const cannedTurnGenerator: TurnGenerator = {
  async generate(ctx) {
    return cannedTurn(ctx);
  },
};

export { TACTICS };
