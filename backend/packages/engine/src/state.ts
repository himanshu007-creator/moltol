import type { NegotiationEvent, Turn } from "@moltol/contracts";

/**
 * Negotiation state, rebuilt from the append-only event log (ADR 0004). The
 * runner and the human-takeover path both read this, never a cached copy, so a
 * restarted worker resumes exactly where the log stops. Steps are committed
 * atomically, so the log never holds half a step.
 */
export interface HaggleState {
  started: boolean;
  ended: boolean;
  endedReason: string | null;
  agreedPriceCents: number | null;
  turns: Turn[];
  /** The buyer's offers/counters: one per round. */
  buyerOffers: Turn[];
  /** The shop's counters. */
  shopCounters: Turn[];
  /** The seq the next event must take. */
  nextSeq: number;
}

export type Mover = "start" | "buyer" | "shop" | "done";

export function replay(events: readonly NegotiationEvent[]): HaggleState {
  const state: HaggleState = {
    started: false,
    ended: false,
    endedReason: null,
    agreedPriceCents: null,
    turns: [],
    buyerOffers: [],
    shopCounters: [],
    nextSeq: 0,
  };
  for (const event of events) {
    state.nextSeq = Math.max(state.nextSeq, event.seq + 1);
    switch (event.t) {
      case "session.started":
        state.started = true;
        break;
      case "turn": {
        const turn = event.turn;
        state.turns.push(turn);
        if (turn.kind === "offer" || turn.kind === "counter") {
          (turn.actor === "buyer" ? state.buyerOffers : state.shopCounters).push(turn);
        }
        break;
      }
      case "deal.agreed":
        state.agreedPriceCents = event.priceCents;
        break;
      case "session.ended":
        state.ended = true;
        state.endedReason = event.reason;
        break;
      default:
        break;
    }
  }
  return state;
}

/** Whose move it is. A buyer offer waits on the shop; a shop counter waits on the buyer. */
export function nextMover(state: HaggleState): Mover {
  if (state.ended) return "done";
  if (!state.started) return "start";
  const last = state.turns[state.turns.length - 1];
  if (!last) return "buyer";
  if (last.kind === "accept" || last.kind === "walkaway") return "done";
  return last.actor === "buyer" ? "shop" : "buyer";
}

/** The shop's standing ask: its last counter, or its opening price before it has spoken. */
export function askOf(state: HaggleState, shopOpenCents: number): number {
  return state.shopCounters[state.shopCounters.length - 1]?.priceCents ?? shopOpenCents;
}

export function lastBuyerOffer(state: HaggleState): number | undefined {
  return state.buyerOffers[state.buyerOffers.length - 1]?.priceCents;
}

export function lastShopCounter(state: HaggleState): number | undefined {
  return state.shopCounters[state.shopCounters.length - 1]?.priceCents;
}
