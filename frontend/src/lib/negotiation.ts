import type { Market, NegotiationEvent, Side, Tactic, TurnKind } from './events';

/**
 * Pure reducer — FE_plan.md §5. `(state, event) => state`.
 * The same function powers: live fixture playback, Replay mode, and tests.
 * No side effects, no timers, no I/O.
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

export type PaymentStatus = 'order_created' | 'approved' | 'captured' | 'failed';

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
  item: string;
  currency: string;
  roundsMax: number;
  market: Market | null;
  commits: Partial<Record<Side, string>>;
  turns: TurnEntry[];
  agreedPriceCents?: number;
  buyerSavedCents: number;
  fairness: number;
  paymentStatus?: PaymentStatus;
  orderId?: string;
  reveal?: RevealInfo;
  endedReason?: 'deal' | 'no_zopa' | 'timeout' | 'human_cancel';
  /** count of events applied — makes the reducer idempotency/debug friendly */
  applied: number;
}

export function initialState(negotiationId = ''): NegotiationState {
  return {
    negotiationId,
    phase: 'connecting',
    item: '',
    currency: 'INR',
    roundsMax: 8,
    market: null,
    commits: {},
    turns: [],
    buyerSavedCents: 0,
    fairness: 0,
    applied: 0,
  };
}

export function reduce(state: NegotiationState, event: NegotiationEvent): NegotiationState {
  const next = { ...state, applied: state.applied + 1 };
  switch (event.t) {
    case 'session.started':
      return {
        ...next,
        negotiationId: event.negotiationId,
        item: event.item,
        currency: event.currency,
        roundsMax: event.roundsMax,
        market: event.market,
        phase: 'negotiating',
      };
    case 'commit.recorded':
      return { ...next, commits: { ...state.commits, [event.side]: event.commit } };
    case 'turn':
      return {
        ...next,
        turns: [
          ...state.turns,
          {
            seq: event.seq,
            actor: event.actor,
            kind: event.kind,
            priceCents: event.priceCents,
            message: event.message,
            tactic: event.tactic,
          },
        ],
      };
    case 'deal.agreed':
      return { ...next, phase: 'agreed', agreedPriceCents: event.priceCents };
    case 'payment.status': {
      const phase: Phase =
        event.status === 'captured' ? 'paid' : event.status === 'failed' ? 'failed' : 'paying';
      return { ...next, paymentStatus: event.status, orderId: event.orderId ?? state.orderId, phase };
    }
    case 'proof.revealed':
      return {
        ...next,
        phase: 'revealed',
        fairness: event.fairness,
        buyerSavedCents: event.buyerSavedCents,
        reveal: { ...event.reveal, verified: event.verified },
      };
    case 'session.ended':
      return {
        ...next,
        endedReason: event.reason,
        phase: event.reason === 'deal' ? state.phase : 'no_deal',
      };
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
