import type { Market, NegotiationEvent, Side, Tactic, TurnKind } from './events';

/**
 * Pure reducer. `(state, event) => state`. The same function powers: the
 * local simulation's tick loop, the real SSE stream, and tests. No side
 * effects, no timers, no I/O.
 */

export type Phase =
  | 'connecting'
  | 'negotiating'
  | 'agreed'
  | 'paying'
  | 'paid'
  | 'revealed'
  | 'no_deal'
  | 'failed';

export type PaymentStatus = 'order_created' | 'approved' | 'captured' | 'failed' | 'refunded';

export interface TurnEntry {
  seq: number;
  actor: Side;
  kind: TurnKind;
  priceCents?: number;
  message: string;
  tactic?: Tactic;
}

export interface RevealInfo {
  buyerLimitCents: number;
  buyerSalt: string;
  shopFloorCents: number;
  shopSalt: string;
  verified: boolean;
}

export interface NegotiationState {
  negotiationId: string;
  phase: Phase;
  currency: string;
  roundsMax: number;
  market: Market | null;
  /** Set together by `limits.sealed` — the backend seals both sides in one event. */
  commits: Partial<Record<Side, string>>;
  turns: TurnEntry[];
  agreedPriceCents?: number;
  buyerSavedCents: number;
  fairness: number;
  /** Who drives the buyer side right now — set by `control.changed`. */
  controller: 'agent' | 'human';
  paymentStatus?: PaymentStatus;
  paypalOrderId?: string;
  paypalCaptureId?: string;
  reveal?: RevealInfo;
  endedReason?: 'deal' | 'no_zopa' | 'timeout' | 'human_cancel' | 'error';
  /** count of events applied — makes the reducer idempotency/debug friendly */
  applied: number;
}

export function initialState(negotiationId = ''): NegotiationState {
  return {
    negotiationId,
    phase: 'connecting',
    currency: 'INR',
    roundsMax: 8,
    market: null,
    commits: {},
    turns: [],
    buyerSavedCents: 0,
    fairness: 0,
    controller: 'agent',
    applied: 0,
  };
}

export function reduce(state: NegotiationState, event: NegotiationEvent): NegotiationState {
  const next = { ...state, applied: state.applied + 1, negotiationId: event.negotiationId || state.negotiationId };
  switch (event.t) {
    case 'session.started':
      return {
        ...next,
        roundsMax: event.roundsMax,
        market: event.market,
        phase: 'negotiating',
      };
    case 'limits.sealed':
      return { ...next, commits: { buyer: event.buyerCommit, shop: event.shopCommit } };
    case 'turn':
      return { ...next, turns: [...state.turns, { ...event.turn }] };
    case 'verdict':
      // Not rendered yet — parsed so an unhandled-event throw never breaks the stream.
      return next;
    case 'deal.agreed':
      return { ...next, phase: 'agreed', agreedPriceCents: event.priceCents, currency: event.currency };
    case 'payment.status': {
      const phase: Phase =
        event.status === 'captured' ? 'paid' : event.status === 'failed' ? 'failed' : 'paying';
      return {
        ...next,
        paymentStatus: event.status,
        paypalOrderId: event.paypalOrderId ?? state.paypalOrderId,
        paypalCaptureId: event.paypalCaptureId ?? state.paypalCaptureId,
        phase,
      };
    }
    case 'proof.revealed':
      return {
        ...next,
        phase: 'revealed',
        fairness: event.fairness,
        buyerSavedCents: event.buyerSavedCents,
        reveal: event.reveal ? { ...event.reveal, verified: event.verified } : state.reveal,
      };
    case 'session.ended':
      return {
        ...next,
        endedReason: event.reason,
        phase: event.reason === 'deal' ? state.phase : 'no_deal',
      };
    case 'control.changed':
      return { ...next, controller: event.controller };
    case 'error':
      return next;
    default:
      return next;
  }
}

export function reduceAll(
  events: readonly NegotiationEvent[],
  start: NegotiationState = initialState(),
): NegotiationState {
  return events.reduce(reduce, start);
}

/* ----------------------------- selectors ----------------------------- */

export interface Series {
  /** index = round (1-based turn order); null = that side didn't move that round */
  buyer: Array<number | null>;
  shop: Array<number | null>;
}

/** Chart series derived from the single source of truth (turns). */
export function selectSeries(state: NegotiationState): Series {
  const buyer: Array<number | null> = [];
  const shop: Array<number | null> = [];
  let buyerLast: number | null = null;
  let shopLast: number | null = null;
  for (const turn of state.turns) {
    if (turn.priceCents == null) continue;
    if (turn.actor === 'buyer') buyerLast = turn.priceCents;
    else shopLast = turn.priceCents;
    buyer.push(buyerLast);
    shop.push(shopLast);
  }
  return { buyer, shop };
}

export function lastOffer(state: NegotiationState, side: Side): number | null {
  for (let i = state.turns.length - 1; i >= 0; i--) {
    const turn = state.turns[i];
    if (turn && turn.actor === side && turn.priceCents != null) return turn.priceCents;
  }
  return null;
}

export function currentRound(state: NegotiationState): number {
  return state.turns.filter((t) => t.priceCents != null).length;
}
