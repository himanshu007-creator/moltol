import { DEFAULT_BAND_PCT, PRICE_ROUNDING_CENTS } from "@moltol/config";
import type { MarketRange, Negotiation, Persona, Side, Turn } from "@moltol/contracts";
import { formatCents } from "@moltol/contracts";
import {
  commit,
  concession,
  newSalt,
  openingAnchor,
  PERSONA_BETA,
  roundToWholeDollars,
  toHex,
} from "@moltol/policy";
import type { SealedRecord, StepBody, StepCommit } from "@moltol/store";
import { deriveShop } from "./baseline";
import { clampToGuard, decidePrice, type PriceDecision } from "./guard-price";
import { lastBuyerOffer, lastShopCounter, replay, type HaggleState } from "./state";
import type { EngineDeps, TurnContext, TurnGenerator, TurnSuggestion } from "./types";

/** How fast the shop concedes when it has no persona of its own (standalone negotiations). */
export const DEFAULT_SHOP_BETA = 0.8;

/** A buyer never opens above this share of the shop's list price on a basket line. */
const BASKET_OPENING_CAP = 0.85;

export type EngineErrorCode =
  "not_found" | "ended" | "not_controlled" | "above_ceiling" | "conflict";

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/** Both sides' policy inputs. `buyerMax` and `shopFloor` come from the sealed vault only. */
export interface Sides {
  buyerMax: number;
  buyerOpen: number;
  buyerBeta: number;
  shopFloor: number;
  shopOpen: number;
  shopBeta: number;
}

export interface LineContext {
  negotiation: Negotiation;
  state: HaggleState;
  market: MarketRange;
  sides: Sides;
  seals: { buyer: SealedRecord; shop: SealedRecord };
}

export type StepOutcome =
  | { kind: "deal"; priceCents: number }
  | { kind: "counter"; priceCents: number }
  | { kind: "offer"; priceCents: number }
  | { kind: "no_deal" }
  | { kind: "control" }
  | { kind: "start" };

export interface PlannedStep {
  bodies: StepBody[];
  patch?: StepCommit["patch"];
  transition?: StepCommit["transition"];
  /** Holds a visible turn: the runner waits `turnDelayMs` before committing it. */
  paced: boolean;
  outcome: StepOutcome;
}

/* ------------------------------- context ------------------------------- */

async function ensureSealed(
  deps: EngineDeps,
  n: Negotiation,
  side: Side,
  limitFor: (saltHex: string) => { limitCents: number; domainCents: number | null },
): Promise<SealedRecord> {
  const existing = await deps.store.getSealed(n.id, side);
  if (existing) return existing;
  const salt = newSalt(16);
  const saltHex = toHex(salt);
  const { limitCents, domainCents } = limitFor(saltHex);
  await deps.store.putSealed({
    negotiationId: n.id,
    side,
    commitment: commit({ negotiationId: n.id, side, currency: n.currency, limitCents }, salt),
    limitCents,
    saltHex,
    domainCents,
  });
  // First writer wins: re-read so every caller uses the seal whose commitment ships.
  const sealed = await deps.store.getSealed(n.id, side);
  if (!sealed) throw new Error(`sealed ${side} limit for ${n.id} was not stored`);
  return sealed;
}

/**
 * Everything a step needs, rebuilt from the store: the negotiation row, its
 * event log, the market, and both sides' limits from the vault. A basket line
 * was sealed when the basket was created (real vendor floor, list-price
 * ceiling); a standalone negotiation derives a counterparty shop and seals it
 * on first use.
 */
export async function loadContext(negotiationId: string, deps: EngineDeps): Promise<LineContext> {
  const n = await deps.store.getNegotiation(negotiationId);
  if (!n) throw new EngineError("not_found", `negotiation ${negotiationId} not found`);
  const state = replay(await deps.store.listEvents(negotiationId));
  const market =
    n.market ??
    (await deps.market.getComps(n.query, n.currency, { referenceCents: n.openCents ?? undefined }));

  let buyer: SealedRecord;
  let shop: SealedRecord;
  let shopOpen: number;
  if (n.basketId) {
    const [b, s] = await Promise.all([
      deps.store.getSealed(n.id, "buyer"),
      deps.store.getSealed(n.id, "shop"),
    ]);
    if (!b || !s || n.openCents === null) {
      throw new Error(`basket line ${n.id} is missing its sealed limits`);
    }
    buyer = b;
    shop = s;
    shopOpen = n.openCents;
  } else {
    buyer = await ensureSealed(deps, n, "buyer", () => ({
      limitCents: n.maxTotalCents,
      domainCents: null,
    }));
    // The counterparty is derived from its own secret salt, so its floor can't be
    // computed from public data (the negotiation id, the market) before the reveal.
    shop = await ensureSealed(deps, n, "shop", (saltHex) => {
      const derived = deriveShop(saltHex, market);
      return { limitCents: derived.floorCents, domainCents: derived.domainCents };
    });
    shopOpen = shop.domainCents ?? deriveShop(n.id, market).openCents;
  }

  const buyerMax = buyer.limitCents;
  let buyerOpen = openingAnchor({ p25Cents: market.p25Cents, maxTotalCents: buyerMax });
  if (n.basketId) {
    // On a basket line the ceiling IS the list price; never open at the sticker.
    buyerOpen = Math.min(
      buyerOpen,
      Math.max(1, roundToWholeDollars(shopOpen * BASKET_OPENING_CAP)),
    );
  }
  return {
    negotiation: n,
    state,
    market,
    seals: { buyer, shop },
    sides: {
      buyerMax,
      buyerOpen,
      buyerBeta: PERSONA_BETA[n.persona] ?? 0.6,
      shopFloor: shop.limitCents,
      shopOpen,
      shopBeta: n.shopPersona
        ? (PERSONA_BETA[n.shopPersona] ?? DEFAULT_SHOP_BETA)
        : DEFAULT_SHOP_BETA,
    },
  };
}

/** The state as if `turn` had been logged — to plan the shop's answer to a human offer in one step. */
export function withTurn(state: HaggleState, turn: Turn): HaggleState {
  const isMove = turn.kind === "offer" || turn.kind === "counter";
  return {
    ...state,
    turns: [...state.turns, turn],
    buyerOffers:
      isMove && turn.actor === "buyer" ? [...state.buyerOffers, turn] : state.buyerOffers,
    shopCounters:
      isMove && turn.actor === "shop" ? [...state.shopCounters, turn] : state.shopCounters,
  };
}

/* ------------------------------- wording ------------------------------- */

function fallbackMessage(actor: Side, priceCents: number, currency: string): string {
  const price = formatCents(priceCents, currency);
  return actor === "buyer" ? `I can do ${price} for this.` : `The best I can do is ${price}.`;
}

async function safeGenerate(
  llm: TurnGenerator,
  ctx: TurnContext,
): Promise<{ priceCents: number; message: string; tactic?: Turn["tactic"] }> {
  try {
    const s: TurnSuggestion = await llm.generate(ctx);
    return {
      priceCents: s.priceCents,
      message: s.message,
      ...(s.tactic ? { tactic: s.tactic } : {}),
    };
  } catch {
    return {
      priceCents: ctx.policyPriceCents,
      message: fallbackMessage(ctx.actor, ctx.policyPriceCents, ctx.currency),
    };
  }
}

function turnContext(
  ctx: LineContext,
  actor: Side,
  persona: Persona,
  round: number,
  policyPriceCents: number,
  opponentLastPriceCents: number | undefined,
): TurnContext {
  const n = ctx.negotiation;
  return {
    negotiationId: n.id,
    actor,
    persona,
    round,
    roundsMax: n.roundsMax,
    market: ctx.market,
    currency: n.currency,
    policyPriceCents,
    ...(opponentLastPriceCents !== undefined ? { opponentLastPriceCents } : {}),
    history: ctx.state.turns.map((t) => ({
      actor: t.actor,
      ...(t.priceCents !== undefined ? { priceCents: t.priceCents } : {}),
      message: t.message,
    })),
  };
}

const bandOf = (deps: EngineDeps): number => deps.bandPct ?? DEFAULT_BAND_PCT;

/* -------------------------------- steps -------------------------------- */

/** session.started + limits.sealed: the commitments go out before any price does. */
export function planStart(ctx: LineContext): PlannedStep {
  const n = ctx.negotiation;
  return {
    bodies: [
      { t: "session.started", roundsMax: n.roundsMax, persona: n.persona, market: ctx.market },
      {
        t: "limits.sealed",
        buyerCommit: ctx.seals.buyer.commitment,
        shopCommit: ctx.seals.shop.commitment,
      },
    ],
    patch: { market: ctx.market },
    transition: { from: ["init"], to: "committed" },
    paced: false,
    outcome: { kind: "start" },
  };
}

export function acceptStep(
  ctx: LineContext,
  actor: Side,
  priceCents: number,
  message: string,
): PlannedStep {
  const { state, negotiation: n } = ctx;
  const turn: Turn = {
    seq: state.turns.length,
    actor,
    kind: "accept",
    priceCents,
    message,
    tactic: "plain",
  };
  return {
    bodies: [
      { t: "turn", turn },
      { t: "deal.agreed", priceCents, currency: n.currency },
      { t: "session.ended", reason: "deal" },
    ],
    patch: { turns: [...state.turns, turn], agreedPriceCents: priceCents },
    transition: { from: ["committed", "negotiating"], to: "agreed" },
    paced: true,
    outcome: { kind: "deal", priceCents },
  };
}

/** The shop walks away without naming a price — so a failed haggle never reveals its floor. */
function walkawayStep(ctx: LineContext): PlannedStep {
  const { state } = ctx;
  const turn: Turn = {
    seq: state.turns.length,
    actor: "shop",
    kind: "walkaway",
    message: "That's below what I can do, so I'll have to pass.",
    tactic: "plain",
  };
  return {
    bodies: [
      { t: "turn", turn },
      { t: "session.ended", reason: "no_zopa" },
    ],
    patch: { turns: [...state.turns, turn] },
    transition: { from: ["committed", "negotiating"], to: "no_deal" },
    paced: true,
    outcome: { kind: "no_deal" },
  };
}

function priceStep(
  ctx: LineContext,
  actor: Side,
  kind: "offer" | "counter",
  usedCents: number,
  suggestion: { message: string; tactic?: Turn["tactic"] },
  decision: PriceDecision,
  bandPct: number,
): PlannedStep {
  const { state, negotiation: n } = ctx;
  const turn: Turn = {
    seq: state.turns.length,
    actor,
    kind,
    priceCents: usedCents,
    // When the guard overrode the model, its wording quoted another number.
    message: decision.ok ? suggestion.message : fallbackMessage(actor, usedCents, n.currency),
    ...(suggestion.tactic ? { tactic: suggestion.tactic } : {}),
  };
  // Every verdict is public and every rejection looks the same: whether a proposal
  // missed the band or crossed a sealed limit, and by how much, would bracket the limit.
  const verdict: StepBody = {
    t: "verdict",
    actor,
    turnSeq: turn.seq,
    ok: decision.ok,
    bandPct,
    usedCents,
    ...(decision.ok
      ? { proposedCents: decision.proposedCents }
      : { reason: "the guard overrode the model's proposal; policy price used" }),
  };
  return {
    bodies: [verdict, { t: "turn", turn }],
    patch: { turns: [...state.turns, turn] },
    transition: { from: ["committed"], to: "negotiating" },
    paced: true,
    outcome: { kind: actor === "buyer" ? "offer" : "counter", priceCents: usedCents },
  };
}

/**
 * The buyer agent's move in round t. It accepts the shop's standing ask when
 * that is no worse than what it was about to offer; otherwise it offers its
 * concession price (never retreating, never past its ceiling). In the final
 * round it meets the shop's ask if it can afford it — it does NOT jump to its
 * own ceiling, which would overpay and announce the ceiling.
 */
export async function planBuyerAgentStep(ctx: LineContext, deps: EngineDeps): Promise<PlannedStep> {
  const { negotiation: n, state, sides } = ctx;
  const T = n.roundsMax;
  const t = state.buyerOffers.length;
  const ask = lastShopCounter(state);
  const prev = lastBuyerOffer(state);
  const guard = {
    side: "buyer" as const,
    limitCents: sides.buyerMax,
    maxTotalCents: sides.buyerMax,
  };

  if (t >= T) return walkawayStep(ctx);
  const isLast = t === T - 1;
  let target = isLast
    ? Math.min(sides.buyerMax, ask ?? sides.buyerMax)
    : concession({
        openCents: sides.buyerOpen,
        limitCents: sides.buyerMax,
        t,
        T,
        beta: sides.buyerBeta,
      });
  if (prev !== undefined) target = Math.max(target, prev);
  target = clampToGuard({ ...guard, priceCents: target });
  if (ask !== undefined && ask <= target) return acceptStep(ctx, "buyer", ask, "Agreed.");

  const suggestion = await safeGenerate(
    deps.llm,
    turnContext(ctx, "buyer", n.persona, t, target, ask),
  );
  const band = bandOf(deps);
  const decision = decidePrice({
    ...guard,
    targetCents: target,
    proposedCents: suggestion.priceCents,
    bandPct: band,
  });
  let used = decision.usedCents;
  if (prev !== undefined) used = Math.max(used, prev);
  if (ask !== undefined && used >= ask) return acceptStep(ctx, "buyer", ask, "Agreed.");
  return priceStep(ctx, "buyer", t === 0 ? "offer" : "counter", used, suggestion, decision, band);
}

/**
 * A counter never names the shop's sealed limit itself while there is room above
 * it: the policy price goes to the LLM and the counter to the public stream.
 */
function offTheLimit(priceCents: number, sides: Sides): number {
  if (priceCents > sides.shopFloor || sides.shopOpen <= sides.shopFloor) return priceCents;
  return Math.min(sides.shopOpen, sides.shopFloor + PRICE_ROUNDING_CENTS);
}

/** The shop's target for round t: its concession curve, never up, never under its floor. */
function shopTarget(ctx: LineContext, t: number, final: boolean): number {
  const { negotiation: n, state, sides } = ctx;
  let target = final
    ? sides.shopFloor
    : concession({
        openCents: sides.shopOpen,
        limitCents: sides.shopFloor,
        t,
        T: n.roundsMax,
        beta: sides.shopBeta,
      });
  const prevAsk = lastShopCounter(state);
  if (prevAsk !== undefined) target = Math.min(target, prevAsk);
  const guarded = clampToGuard({
    side: "shop",
    priceCents: target,
    limitCents: sides.shopFloor,
    maxTotalCents: sides.shopOpen,
  });
  // The final round's target is only an acceptance threshold, never a counter.
  return final ? guarded : offTheLimit(guarded, sides);
}

async function shopCounter(
  ctx: LineContext,
  deps: EngineDeps,
  t: number,
  bid: number,
  target: number,
): Promise<PlannedStep> {
  const { negotiation: n, state, sides } = ctx;
  const suggestion = await safeGenerate(
    deps.llm,
    turnContext(ctx, "shop", n.shopPersona ?? "analyst", t, target, bid),
  );
  const band = bandOf(deps);
  // The shop's own list price bounds it from above — never the buyer's private mandate.
  const decision = decidePrice({
    side: "shop",
    targetCents: target,
    proposedCents: suggestion.priceCents,
    bandPct: band,
    limitCents: sides.shopFloor,
    maxTotalCents: sides.shopOpen,
  });
  let used = offTheLimit(decision.usedCents, sides);
  const prevAsk = lastShopCounter(state);
  if (prevAsk !== undefined) used = Math.min(used, prevAsk);
  if (used <= bid) return acceptStep(ctx, "shop", bid, "Deal — that works.");
  return priceStep(ctx, "shop", "counter", used, suggestion, decision, band);
}

/**
 * The shop agent answering the buyer's offer in round t: accept when the offer
 * reaches what it would counter with, otherwise counter. In the final round it
 * accepts anything at or above its floor, else walks away without a number.
 */
export async function planShopAgentStep(ctx: LineContext, deps: EngineDeps): Promise<PlannedStep> {
  const { negotiation: n, state } = ctx;
  const bid = lastBuyerOffer(state);
  if (bid === undefined) throw new Error("shop has no buyer offer to answer");
  const t = state.buyerOffers.length - 1;
  const final = t >= n.roundsMax - 1;
  const target = shopTarget(ctx, t, final);
  if (bid >= target) return acceptStep(ctx, "shop", bid, "Deal — that works.");
  if (final) return walkawayStep(ctx);
  return shopCounter(ctx, deps, t, bid, target);
}

/**
 * The shop answering a human-driven buyer. It never walks away (haggling over
 * something already in the basket always lands on a price): past the last
 * round it holds its final concession, which stays above its floor, and the
 * buyer can always accept that.
 */
export async function planShopHumanResponse(
  ctx: LineContext,
  deps: EngineDeps,
): Promise<PlannedStep> {
  const { negotiation: n, state } = ctx;
  const bid = lastBuyerOffer(state);
  if (bid === undefined) throw new Error("shop has no buyer offer to answer");
  const t = state.buyerOffers.length - 1;
  const target = shopTarget(ctx, Math.min(t, n.roundsMax - 1), false);
  if (bid >= target) return { ...acceptStep(ctx, "shop", bid, "Deal — that works."), paced: false };
  return { ...(await shopCounter(ctx, deps, t, bid, target)), paced: false };
}

export function controlStep(): PlannedStep {
  return {
    bodies: [{ t: "control.changed", controller: "human" }],
    patch: { controlled: true },
    paced: false,
    outcome: { kind: "control" },
  };
}
