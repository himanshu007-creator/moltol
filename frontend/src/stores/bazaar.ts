import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '@/lib/idb';
import { initialState, reduce, type NegotiationState } from '@/lib/negotiation';
import type { NegotiationEvent } from '@/lib/events';
import { openBasketStream } from '@/lib/basketStream';
import {
  acceptAllLines,
  acceptLine,
  createBasket,
  offerLine,
  takeoverLine,
  type Basket,
} from '@/lib/backend';
import { useSession } from '@/stores/session';
import type { Shop, InventoryItem, I18nName } from '@/lib/types';
import type { NegotiationRequest } from '@/lib/personality';

export type HaggleStyle = 'polite' | 'firm' | 'playful';
export type Scope = 'all' | 'chosen';

export interface Lane {
  sku: string;
  itemId: string;
  /** The real backend negotiation id for this lane (= lineItemId). */
  backendLineId?: string;
  title: I18nName;
  emoji: string;
  unit: string;
  qty: number;
  listCents: number;
  state: NegotiationState;
  running: boolean;
  controlled: boolean; // human takeover
  done: boolean;
  noDeal: boolean;
}

export interface BazaarState {
  id: string;
  shopId: string;
  shopName: I18nName;
  shopEmoji: string;
  scope: Scope;
  style: HaggleStyle;
  budgetCents: number | null;
  /** the personality request this haggle was started with */
  request: NegotiationRequest | null;
  lanes: Lane[];
  begun: boolean;
  stage: 'idle' | 'haggling' | 'summary';
  /** The real backend basket id, once a real basket was created. */
  basketId: string | null;
  /** Set when `start()` couldn't open a real basket — no shop/item/session to haggle against. */
  error: string | null;

  start: (
    shop: Shop,
    lines: Array<{ item: InventoryItem; qty: number }>,
    opts: Partial<{ scope: Scope; style: HaggleStyle; budgetCents: number | null; request: NegotiationRequest }>,
  ) => Promise<void>;
  takeOver: (sku: string) => void;
  humanOffer: (sku: string, cents: number) => void;
  acceptLane: (sku: string) => void;
  acceptAll: () => void;
  resume: () => void;
  settle: () => void;
  reset: () => void;
}

type BazaarData = Omit<
  BazaarState,
  'start' | 'takeOver' | 'humanOffer' | 'acceptLane' | 'acceptAll' | 'resume' | 'settle' | 'reset'
>;

const EMPTY: BazaarData = {
  id: '',
  shopId: '',
  shopName: { en: '' },
  shopEmoji: '🛺',
  scope: 'all',
  style: 'polite',
  budgetCents: null,
  request: null,
  lanes: [],
  begun: false,
  stage: 'idle',
  basketId: null,
  error: null,
};

let stopStream: (() => void) | null = null;

function stopSse() {
  if (stopStream) {
    stopStream();
    stopStream = null;
  }
}

/** Apply one SSE frame to whichever lane it belongs to (matched by backendLineId). */
function applyRemoteEvent(s: BazaarState, event: NegotiationEvent): BazaarState {
  const lanes = s.lanes.map((l) => {
    if (l.backendLineId !== event.negotiationId) return l;
    const state = reduce(l.state, event);
    const done = event.t === 'session.ended' || event.t === 'deal.agreed' ? true : l.done || state.phase === 'paid' || state.phase === 'revealed';
    return { ...l, state, done, running: !done, controlled: state.controller === 'human' };
  });
  return { ...s, lanes };
}

export const useBazaar = create<BazaarState>()(
  persist(
    (set, get) => ({
      ...EMPTY,

      start: async (shop, lines, opts) => {
        stopSse();
        set({ error: null });

        const token = useSession.getState().token;
        const backendItemIds = lines.every((l) => l.item.backendItemId);
        if (!shop.backendShopId || !token || !backendItemIds) {
          set({ ...EMPTY, error: "This stall isn't ready to haggle yet — its items aren't fully set up." });
          return;
        }
        try {
          const basket = await createBasket(token, {
            shopId: shop.backendShopId,
            lines: lines.map((l) => ({ itemId: l.item.backendItemId!, qty: l.qty })),
            request: opts.request
              ? { preset: opts.request.preset, rounds: opts.request.rounds, tone: opts.request.tone }
              : undefined,
          });
          startRemote(set, shop, lines, opts, basket);
        } catch {
          set({ ...EMPTY, error: "Couldn't start the haggle — try again in a moment." });
        }
      },

      takeOver: (sku) => {
        const lane = get().lanes.find((l) => l.sku === sku);
        set((s) => ({ lanes: s.lanes.map((l) => (l.sku === sku ? { ...l, controlled: true } : l)) }));
        const { basketId } = get();
        const token = useSession.getState().token;
        if (basketId && lane?.backendLineId && token) {
          void takeoverLine(token, basketId, lane.backendLineId).catch(() => {});
        }
      },

      humanOffer: (sku, cents) => {
        const { basketId } = get();
        const lane = get().lanes.find((l) => l.sku === sku);
        const token = useSession.getState().token;
        if (basketId && lane?.backendLineId && token) {
          void offerLine(token, basketId, lane.backendLineId, cents).catch(() => {});
        }
        // the SSE stream applies the resulting turn/verdict
      },

      acceptLane: (sku) => {
        const { basketId } = get();
        const lane = get().lanes.find((l) => l.sku === sku);
        const token = useSession.getState().token;
        if (basketId && lane?.backendLineId && token) {
          void acceptLine(token, basketId, lane.backendLineId).catch(() => {});
        }
      },

      acceptAll: () => {
        const { basketId } = get();
        const token = useSession.getState().token;
        if (basketId && token) void acceptAllLines(token, basketId).catch(() => {});
      },

      /** Reconnect the SSE stream after a full page reload froze it. */
      resume: () => {
        const s = get();
        if (s.stage !== 'haggling' || !s.lanes.some((l) => !l.done) || !s.basketId || stopStream) return;
        connectStream(set, s.basketId);
      },
      settle: () => {
        stopSse();
        set((s) => ({
          stage: 'summary',
          lanes: s.lanes.map((l) => ({ ...l, running: false, done: true, noDeal: l.noDeal || l.state.phase === 'no_deal' || (l.state.phase !== 'agreed' && !l.state.agreedPriceCents) })),
        }));
      },
      reset: () => {
        stopSse();
        set(EMPTY);
      },
    }),
    {
      name: 'moltol-bazaar',
      storage: createJSONStorage(() => idbStorage),
    },
  ),
);

function startRemote(
  set: (partial: Partial<BazaarState> | ((s: BazaarState) => Partial<BazaarState>)) => void,
  shop: Shop,
  lines: Array<{ item: InventoryItem; qty: number }>,
  opts: Partial<{ scope: Scope; style: HaggleStyle; budgetCents: number | null; request: NegotiationRequest }>,
  basket: Basket,
) {
  const lanes: Lane[] = lines.map((line) => {
    const bl = basket.lines.find((x) => x.itemId === line.item.backendItemId);
    return {
      sku: line.item.backendItemId!,
      itemId: line.item.itemId,
      backendLineId: bl?.lineItemId,
      title: line.item.title,
      emoji: line.item.emoji,
      unit: line.item.unit,
      qty: line.qty,
      listCents: bl?.listLineCents ?? line.item.listCents * line.qty,
      state: initialState(bl?.lineItemId ?? ''),
      running: true,
      controlled: bl?.controlled ?? false,
      done: false,
      noDeal: false,
    };
  });

  set({
    ...EMPTY,
    id: basket.id,
    shopId: shop.id,
    shopName: shop.name,
    shopEmoji: shop.emoji,
    scope: opts.scope ?? 'all',
    style: opts.style ?? 'polite',
    budgetCents: opts.budgetCents ?? null,
    request: opts.request ?? null,
    lanes,
    begun: true,
    stage: 'haggling',
    basketId: basket.id,
  });

  connectStream(set, basket.id);
}

/** The basket id is the capability for this endpoint — no auth header needed or sent. */
function connectStream(
  set: (partial: Partial<BazaarState> | ((s: BazaarState) => Partial<BazaarState>)) => void,
  basketId: string,
) {
  const base = (import.meta.env.PUBLIC_BACKEND_BASE as string | undefined) ?? '';
  if (!base) return;
  stopStream = openBasketStream(`${base}/v1/baskets/${basketId}/events`, {
    onEvent: (event) => set((s) => applyRemoteEvent(s, event)),
  });
}

function lastPrice(state: NegotiationState): number | null {
  for (let i = state.turns.length - 1; i >= 0; i--) {
    const t = state.turns[i];
    if (t && t.priceCents != null) return t.priceCents;
  }
  return null;
}

/** One lane as selectBazaar projects it — the shape BazaarTheatre's cards render from. */
export type LaneSummary = ReturnType<typeof selectBazaar>['lanes'][number];

/** Live aggregated view for the sticky bar + final summary. */
export function selectBazaar(s: BazaarState) {
  const lanes = s.lanes.map((l) => {
    // The agreed price is set on `deal.agreed` and survives the later
    // `payment.status` (→ paid) and `proof.revealed` (→ revealed) phases —
    // gating on `phase === 'agreed'` dropped every lane to ₹0 the moment
    // payment captured, since the basket stream stays open through checkout.
    const agreed = l.state.agreedPriceCents ?? null;
    return {
      sku: l.sku,
      title: l.title,
      emoji: l.emoji,
      unit: l.unit,
      qty: l.qty,
      itemId: l.itemId,
      listCents: l.listCents,
      marketCents: l.state.market ? Math.round(l.state.market.medianCents * l.qty) : null,
      agreedCents: agreed != null ? Math.round(agreed * l.qty) : null,
      savedCents: agreed != null ? Math.max(0, Math.round(l.listCents - agreed * l.qty)) : 0,
      noDeal: l.noDeal || (agreed == null && l.done),
      done: l.done,
      controlled: l.controlled,
      running: l.running,
      priceCents: l.state.agreedPriceCents ?? lastPrice(l.state),
      fairness: l.state.fairness,
      turns: l.state.turns,
      /** the full negotiation state, for the offer chart (HaggleChart) */
      state: l.state,
    };
  });
  const totalList = lanes.reduce((s2, l) => s2 + l.listCents, 0);
  const totalMarket = lanes.reduce((s2, l) => s2 + (l.marketCents ?? 0), 0);
  const totalAgreed = lanes.reduce((s2, l) => s2 + (l.agreedCents ?? 0), 0);
  const noDealCount = lanes.filter((x) => x.noDeal).length;
  const doneCount = lanes.filter((x) => x.done).length;
  const fair = lanes.filter((x) => x.done && !x.noDeal).length
    ? 100
    : 0;
  return {
    lanes,
    totalListCents: totalList,
    totalMarketCents: totalMarket,
    totalAgreedCents: totalAgreed,
    totalSavedCents: Math.max(0, totalList - totalAgreed),
    noDealCount,
    doneCount,
    totalDone: lanes.length,
    readiness: lanes.length ? Math.round((doneCount / lanes.length) * 100) : 0,
    fairness: fair,
  };
}
