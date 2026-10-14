import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '@/lib/idb';
import { initialState, reduce, type NegotiationState } from '@/lib/negotiation';
import { parseEvent } from '@/lib/events';
import { buildCartScript, type Shop, type InventoryItem } from '@/lib/mock/seeds';
import type { I18nName } from '@/lib/mock/seeds';
import type { NegotiationRequest } from '@/lib/personality';

export type HaggleStyle = 'polite' | 'firm' | 'playful';
export type Scope = 'all' | 'chosen';

export interface Lane {
  sku: string;
  itemId: string;
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
  /** ms of lane-time elapsed (speed-scaled) */
  elapsedMs: number;
}

export interface QueuedEve {
  delayMs: number;
  ev: { t: string; [k: string]: unknown };
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
  /** per lane, the scripted stream */
  queue: Record<string, QueuedEve[]>;
  speed: number;
  begun: boolean;
  stage: 'idle' | 'haggling' | 'summary';

  start: (
    shop: Shop,
    lines: Array<{ item: InventoryItem; qty: number }>,
    opts: Partial<{ scope: Scope; style: HaggleStyle; budgetCents: number | null; request: NegotiationRequest }>,
  ) => void;
  takeOver: (sku: string) => void;
  humanOffer: (sku: string, cents: number) => void;
  acceptLane: (sku: string) => void;
  acceptAll: () => void;
  setSpeed: (speed: number) => void;
  pauseAll: () => void;
  resumeAll: () => void;
  resume: () => void;
  settle: () => void;
  reset: () => void;
}

type BazaarData = Omit<
  BazaarState,
  'start' | 'takeOver' | 'humanOffer' | 'acceptLane' | 'acceptAll' | 'setSpeed' | 'pauseAll' | 'resumeAll' | 'resume' | 'settle' | 'reset'
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
  queue: {},
  speed: 1,
  begun: false,
  stage: 'idle',
};

let timer: ReturnType<typeof setInterval> | null = null;

function stopClock() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function tick(s: BazaarState): BazaarState {
  const dt = 320 * s.speed;
  let anyLeft = false;
  const lanes = s.lanes.map((l) => {
    if (!l.running || l.done) return l;
    let elapsed = l.elapsedMs + dt;
    const queued = (s.queue[l.sku] ?? []).slice();
    let state = l.state;
    let done: boolean = l.done;
    let noDeal: boolean = l.noDeal;
    let running: boolean = l.running;
    while (queued.length && queued[0]!.delayMs <= elapsed) {
      const item = queued.shift()!;
      try {
        state = reduce(state, parseEvent(item.ev));
      } catch {
        /* skip malformed frame */
      }
      if (item.ev.t === 'session.ended' || item.ev.t === 'deal.agreed') {
        done = true;
        running = false;
        noDeal = noDeal || item.ev.t === 'session.ended';
        break;
      }
    }
    if (!done) anyLeft = true;
    return { ...l, elapsedMs: elapsed, state, done, noDeal, running };
  });
  const queue: Record<string, QueuedEve[]> = {};
  for (const l of lanes) queue[l.sku] = (s.queue[l.sku] ?? []).filter((e) => e.delayMs > l.elapsedMs);
  if (!anyLeft) stopClock();
  return { ...s, lanes, queue };
}

export const useBazaar = create<BazaarState>()(
  persist(
    (set, get) => ({
      ...EMPTY,

      start: (shop, lines, opts) => {
        stopClock();
        const scripts = buildCartScript(shop, lines);
        const baseDist = 900; // lane stagger
        const lanes: Lane[] = scripts.map((script, i) => {
          const line = lines[i]!;
          return {
            sku: script.sku,
            itemId: line.item.itemId,
            title: line.item.title,
            emoji: line.item.emoji,
            unit: line.item.unit,
            qty: line.qty,
            listCents: line.item.listCents * line.qty,
            state: initialState(`b-${script.sku}`),
            running: true,
            controlled: false,
            done: false,
            noDeal: false,
            elapsedMs: 0,
          };
        });
        const queue: Record<string, QueuedEve[]> = {};
        scripts.forEach((script, i) => {
          // buildScript emits per-step delays; convert to absolute, ascending
          // lane-time so the ordered tick loop + filter fire every event.
          let acc = 0;
          queue[script.sku] = script.events.map((e) => {
            acc += e.delayMs;
            return { delayMs: acc + i * baseDist, ev: e.ev };
          });
        });

        set({
          ...EMPTY,
          id: `bazaar-${Date.now().toString(36)}`,
          shopId: shop.id,
          shopName: shop.name,
          shopEmoji: shop.emoji,
          scope: opts.scope ?? 'all',
          style: opts.style ?? 'polite',
          budgetCents: opts.budgetCents ?? null,
          request: opts.request ?? null,
          lanes,
          queue,
          begun: true,
          stage: 'haggling',
        });

        timer = setInterval(() => set((s) => (s.stage === 'haggling' ? tick(s) : s)), 320);
      },

      takeOver: (sku) =>
        set((s) => ({
          lanes: s.lanes.map((l) => (l.sku === sku ? { ...l, controlled: true } : l)),
        })),

      humanOffer: (sku, cents) =>
        set((s) => ({
          lanes: s.lanes.map((l) => {
            if (l.sku !== sku || l.done) return l;
            const ev = { t: 'turn', seq: l.state.turns.length + 1, actor: 'buyer', kind: 'counter', priceCents: cents, message: 'human says' } as const;
            return { ...l, state: reduce(l.state, ev) };
          }),
        })),

      acceptLane: (sku) =>
        set((s) => ({
          lanes: s.lanes.map((l) => {
            if (l.sku !== sku || l.done) return l;
            const last = lastPrice(l.state);
            if (last == null) return l;
            const st = reduce(
              reduce(l.state, { t: 'turn', seq: l.state.turns.length + 1, actor: 'buyer', kind: 'accept', priceCents: last, message: 'deal' }),
              { t: 'deal.agreed', priceCents: last },
            );
            return { ...l, state: st, running: false, done: true, controlled: false };
          }),
        })),

      acceptAll: () => {
        for (const l of get().lanes) if (!l.done && !l.noDeal) get().acceptLane(l.sku);
      },

      setSpeed: (speed) => set({ speed }),
      pauseAll: () => set((s) => ({ lanes: s.lanes.map((l) => (l.done ? l : { ...l, running: false })) })),
      resumeAll: () => set((s) => ({ lanes: s.lanes.map((l) => (l.done ? l : { ...l, running: true })) })),
      /** Restart the sim clock after a full page reload froze the interval. */
      resume: () => {
        const s = get();
        if (timer || s.stage !== 'haggling' || !s.lanes.some((l) => !l.done)) return;
        timer = setInterval(() => set((st) => (st.stage === 'haggling' ? tick(st) : st)), 320);
      },
      settle: () => {
        stopClock();
        set((s) => ({
          stage: 'summary',
          lanes: s.lanes.map((l) => ({ ...l, running: false, done: true, noDeal: l.noDeal || l.state.phase === 'no_deal' || (l.state.phase !== 'agreed' && !l.state.agreedPriceCents) })),
        }));
      },
      reset: () => {
        stopClock();
        set(EMPTY);
      },
    }),
    {
      name: 'moltol-bazaar',
      storage: createJSONStorage(() => idbStorage),
    },
  ),
);

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
    const agreed = l.state.phase === 'agreed' ? l.state.agreedPriceCents : null;
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
      noDeal: l.noDeal || (l.state.phase !== 'agreed' && agreed == null && l.done),
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