import { DEFAULT_BAND_PCT } from "@moltol/config";
import type {
  EventInput,
  MarketRange,
  Negotiation,
  NegotiationEvent,
  Side,
  Turn,
} from "@moltol/contracts";
import { canTransition } from "@moltol/contracts";
import {
  commit,
  concession,
  fairnessScore,
  finalRoundOffer,
  newSalt,
  openingAnchor,
  PERSONA_BETA,
  shouldAccept,
  toHex,
} from "@moltol/policy";
import type { SealedRecord } from "@moltol/store";
import { deriveShop, type ShopModel } from "./baseline";
import { decidePrice } from "./guard-price";
import type { EngineDeps, HaggleOutcome, TurnGenerator } from "./types";

function fallbackSuggestion(
  targetCents: number,
  actor: Side,
): { priceCents: number; message: string } {
  const dollars = (targetCents / 100).toFixed(2);
  return {
    priceCents: targetCents,
    message:
      actor === "buyer" ? `I can do $${dollars} for this.` : `The best I can do is $${dollars}.`,
  };
}

async function safeGenerate(
  llm: TurnGenerator,
  ctx: Parameters<TurnGenerator["generate"]>[0],
): Promise<{ priceCents: number; message: string; tactic?: Turn["tactic"] }> {
  try {
    const s = await llm.generate(ctx);
    return { priceCents: s.priceCents, message: s.message, tactic: s.tactic };
  } catch {
    return fallbackSuggestion(ctx.policyPriceCents, ctx.actor);
  }
}

async function ensureSealed(
  deps: EngineDeps,
  n: Negotiation,
  side: Side,
  limitCents: number,
  domainCents: number | null,
): Promise<SealedRecord> {
  const existing = await deps.store.getSealed(n.id, side);
  if (existing) return existing;
  const salt = newSalt(16);
  const commitment = commit({ negotiationId: n.id, side, currency: n.currency, limitCents }, salt);
  const record: SealedRecord = {
    negotiationId: n.id,
    side,
    commitment,
    limitCents,
    saltHex: toHex(salt),
    domainCents,
  };
  await deps.store.putSealed(record);
  return record;
}

/**
 * The negotiation runner. Deterministic given (negotiation, market, LLM output):
 * every price is produced by policy and passed through the guard. Emits the full
 * event list, but skips `seq < nextSeq` so a restart resumes instead of
 * duplicating (append-only event log).
 */
export async function runHaggle(negotiationId: string, deps: EngineDeps): Promise<HaggleOutcome> {
  const band = deps.bandPct ?? DEFAULT_BAND_PCT;
  const n = await deps.store.getNegotiation(negotiationId);
  if (!n) throw new Error(`negotiation ${negotiationId} not found`);

  const market: MarketRange = n.market ?? (await deps.market.getComps(n.query, n.currency));
  const beta = PERSONA_BETA[n.persona] ?? 0.6;
  const buyerOpen = openingAnchor({ p25Cents: market.p25Cents, maxTotalCents: n.maxTotalCents });
  const shop: ShopModel = deriveShop(n.id, market);

  const buyerSeal = await ensureSealed(deps, n, "buyer", n.maxTotalCents, null);
  const shopSeal = await ensureSealed(deps, n, "shop", shop.floorCents, shop.domainCents);

  const bodies: EventInput[] = [];
  bodies.push({
    t: "session.started",
    roundsMax: n.roundsMax,
    persona: n.persona,
    market,
  });
  bodies.push({
    t: "limits.sealed",
    buyerCommit: buyerSeal.commitment,
    shopCommit: shopSeal.commitment,
  });

  const turns: Turn[] = [];
  const history: { actor: Side; priceCents?: number; message: string }[] = [];
  let turnSeq = 0;
  let agreed: number | null = null;
  let rounds = 0;
  let lastShopPrice: number | undefined;

  for (let t = 0; t < n.roundsMax && agreed === null; t++) {
    rounds = t + 1;
    const isLast = t === n.roundsMax - 1;

    /* ------------------------------- buyer turn ------------------------------ */
    const buyerTarget = isLast
      ? finalRoundOffer(n.maxTotalCents)
      : concession({ openCents: buyerOpen, limitCents: n.maxTotalCents, t, T: n.roundsMax, beta });

    const buyerSug = await safeGenerate(deps.llm, {
      negotiationId: n.id,
      actor: "buyer",
      persona: n.persona,
      round: t,
      roundsMax: n.roundsMax,
      market,
      policyPriceCents: buyerTarget,
      ...(lastShopPrice !== undefined ? { opponentLastPriceCents: lastShopPrice } : {}),
      history: [...history],
    });
    const buyerDecision = decidePrice({
      side: "buyer",
      targetCents: buyerTarget,
      proposedCents: buyerSug.priceCents,
      bandPct: band,
      limitCents: n.maxTotalCents,
      maxTotalCents: n.maxTotalCents,
    });
    bodies.push({
      t: "verdict",
      actor: "buyer",
      turnSeq,
      ok: buyerDecision.ok,
      bandPct: band,
      proposedCents: buyerDecision.proposedCents,
      usedCents: buyerDecision.usedCents,
      ...(buyerDecision.reason ? { reason: buyerDecision.reason } : {}),
    });
    const buyerTurn: Turn = {
      seq: turnSeq,
      actor: "buyer",
      kind: t === 0 ? "offer" : "counter",
      priceCents: buyerDecision.usedCents,
      message: buyerSug.message,
      ...(buyerSug.tactic ? { tactic: buyerSug.tactic } : {}),
    };
    turns.push(buyerTurn);
    history.push({ actor: "buyer", priceCents: buyerTurn.priceCents, message: buyerTurn.message });
    bodies.push({ t: "turn", turn: buyerTurn });
    turnSeq++;

    const shopTargetThisRound = isLast
      ? finalRoundOffer(shop.floorCents)
      : concession({
          openCents: shop.openCents,
          limitCents: shop.floorCents,
          t,
          T: n.roundsMax,
          beta: 0.8,
        });

    if (
      shouldAccept({
        side: "shop",
        incomingCents: buyerDecision.usedCents,
        myNextOfferCents: shopTargetThisRound,
        myLimitCents: shop.floorCents,
      })
    ) {
      const accept: Turn = {
        seq: turnSeq,
        actor: "shop",
        kind: "accept",
        priceCents: buyerDecision.usedCents,
        message: "Deal — that works.",
        tactic: "plain",
      };
      turns.push(accept);
      history.push({ actor: "shop", priceCents: accept.priceCents, message: accept.message });
      bodies.push({ t: "turn", turn: accept });
      turnSeq++;
      agreed = buyerDecision.usedCents;
      break;
    }

    /* -------------------------------- shop turn ------------------------------ */
    const shopSug = await safeGenerate(deps.llm, {
      negotiationId: n.id,
      actor: "shop",
      persona: "analyst",
      round: t,
      roundsMax: n.roundsMax,
      market,
      policyPriceCents: shopTargetThisRound,
      opponentLastPriceCents: buyerDecision.usedCents,
      history: [...history],
    });
    const shopDecision = decidePrice({
      side: "shop",
      targetCents: shopTargetThisRound,
      proposedCents: shopSug.priceCents,
      bandPct: band,
      limitCents: shop.floorCents,
      maxTotalCents: n.maxTotalCents,
    });
    bodies.push({
      t: "verdict",
      actor: "shop",
      turnSeq,
      ok: shopDecision.ok,
      bandPct: band,
      proposedCents: shopDecision.proposedCents,
      usedCents: shopDecision.usedCents,
      ...(shopDecision.reason ? { reason: shopDecision.reason } : {}),
    });
    const shopTurn: Turn = {
      seq: turnSeq,
      actor: "shop",
      kind: "counter",
      priceCents: shopDecision.usedCents,
      message: shopSug.message,
      ...(shopSug.tactic ? { tactic: shopSug.tactic } : {}),
    };
    turns.push(shopTurn);
    history.push({ actor: "shop", priceCents: shopTurn.priceCents, message: shopTurn.message });
    bodies.push({ t: "turn", turn: shopTurn });
    turnSeq++;
    lastShopPrice = shopDecision.usedCents;

    if (
      shouldAccept({
        side: "buyer",
        incomingCents: shopDecision.usedCents,
        myNextOfferCents: buyerTarget,
        myLimitCents: n.maxTotalCents,
      })
    ) {
      const accept: Turn = {
        seq: turnSeq,
        actor: "buyer",
        kind: "accept",
        priceCents: shopDecision.usedCents,
        message: "Agreed.",
        tactic: "plain",
      };
      turns.push(accept);
      history.push({ actor: "buyer", priceCents: accept.priceCents, message: accept.message });
      bodies.push({ t: "turn", turn: accept });
      turnSeq++;
      agreed = shopDecision.usedCents;
      break;
    }
  }

  const fairness = agreed === null ? 0 : fairnessScore(agreed, shop.floorCents, n.maxTotalCents);

  if (agreed !== null) {
    bodies.push({ t: "deal.agreed", priceCents: agreed, currency: n.currency, fairness });
    bodies.push({ t: "session.ended", reason: "deal" });
  } else {
    bodies.push({ t: "session.ended", reason: "no_zopa" });
  }

  /* ---------------------- persist + publish, resumably ------------------- */
  const startSeq = await deps.store.nextSeq(n.id);
  for (let i = 0; i < bodies.length; i++) {
    if (i < startSeq) continue;
    const event = deps.store.makeEvent(n.id, i, bodies[i]!);
    await deps.store.appendEvent(event);
    if (deps.onEvent) await deps.onEvent(event);
  }

  // advance the state machine (conditional; a resume may already be past this)
  if (n.state === "init") await deps.store.transition(n.id, "init", "committed");
  if (canTransition("committed", "negotiating"))
    await deps.store.transition(n.id, "committed", "negotiating");

  if (agreed !== null) {
    await deps.store.setAgreed(n.id, agreed, market, turns);
    await deps.store.transition(n.id, "negotiating", "agreed");
  } else {
    await deps.store.setTurns(n.id, turns);
    await deps.store.transition(n.id, "negotiating", "no_deal");
  }

  deps.log?.({
    negotiationId: n.id,
    state: agreed === null ? "no_deal" : "agreed",
    agreed,
    turns: turns.length,
  });

  return {
    state: agreed === null ? "no_deal" : "agreed",
    agreedPriceCents: agreed,
    turns,
    rounds,
  };
}
