import { create } from 'zustand';
import type { NegotiationEvent } from '@/lib/events';
import {
  initialState,
  lastOffer,
  reduce,
  type NegotiationState,
} from '@/lib/negotiation';
import { currentRound } from '@/lib/negotiation';
import { runNegotiation, type RunOptions } from '@/lib/engine';
import { formatMoney } from '@/lib/money';
import { loadFixture, openSocket, playEvents, useFixture, type StreamStatus } from '@/lib/ws';

export type Source = 'engine' | 'replay' | 'socket';

interface NegotiationStore {
  state: NegotiationState;
  status: StreamStatus;
  source: Source;
  takeover: boolean;
  speed: number;
  runOpts: RunOptions | null;
  stop: (() => void) | null;

  applyEvent: (event: NegotiationEvent) => void;
  startEngine: (opts: RunOptions) => Promise<void>;
  startReplay: (productId?: string) => void;
  startSocket: (url: string) => void;
  restart: () => void;
  setSpeed: (speed: number) => void;
  takeOver: (on: boolean) => void;
  humanOffer: (priceCents: number) => void;
  halt: () => void;
}

function nextSeq(state: NegotiationState): number {
  const last = state.turns[state.turns.length - 1];
  return last ? last.seq + 1 : 0;
}

export const useNegotiation = create<NegotiationStore>((set, get) => ({
  state: initialState(),
  status: 'connecting',
  source: 'engine',
  takeover: false,
  speed: 1,
  runOpts: null,
  stop: null,

  applyEvent: (event) => set((s) => ({ state: reduce(s.state, event) })),

  startEngine: async (opts) => {
    get().stop?.();
    set({ state: initialState(opts.negotiationId), status: 'connecting', source: 'engine', takeover: false, runOpts: opts });
    if (!useFixture() && import.meta.env.PUBLIC_WS_BASE) {
      get().startSocket(`${import.meta.env.PUBLIC_WS_BASE}/v1/stream/${opts.negotiationId}`);
      return;
    }
    const events = await runNegotiation(opts);
    const stop = playEvents(events, {
      onEvent: (e) => get().applyEvent(e),
      onStatus: (status) => set({ status }),
    }, { speed: get().speed });
    set({ stop });
  },

  startReplay: (productId) => {
    get().stop?.();
    const fixture = loadFixture();
    set({
      state: initialState(fixture.negotiationId),
      status: 'connecting',
      source: 'replay',
      takeover: false,
      runOpts: { negotiationId: fixture.negotiationId, productId: productId ?? fixture.productId, buyerMaxCents: 2200 },
    });
    const stop = playEvents(fixture.events, {
      onEvent: (e) => get().applyEvent(e),
      onStatus: (status) => set({ status }),
    }, { speed: get().speed, replay: true });
    set({ stop });
  },

  startSocket: (url) => {
    get().stop?.();
    set({ status: 'connecting', source: 'socket' });
    const stop = openSocket(url, {
      onEvent: (e) => get().applyEvent(e),
      onStatus: (status) => set({ status }),
    });
    set({ stop });
  },

  restart: () => {
    const { source, runOpts } = get();
    if (source === 'replay') get().startReplay(runOpts?.productId);
    else if (runOpts) void get().startEngine(runOpts);
  },

  setSpeed: (speed) => set({ speed }),

  takeOver: (on) => set({ takeover: on }),

  /** A human buyer's offer: still client-guarded to the mandate, then the shop replies. */
  humanOffer: (priceCents) => {
    const s = get().state;
    const max = get().runOpts?.buyerMaxCents;
    if (priceCents <= 0) return;
    if (max != null && priceCents > max) return; // fail closed — over the mandate
    get().applyEvent({
      t: 'turn',
      seq: nextSeq(s),
      actor: 'buyer',
      kind: 'offer',
      priceCents,
      message: `(you) I can do ${formatMoney(priceCents, s.currency)}.`,
    });
  },

  halt: () => {
    get().stop?.();
    set({ stop: null, status: 'closed' });
  },
}));

/** Convenience selectors used across islands. */
export const selectBuyerOffer = (s: NegotiationState) => lastOffer(s, 'buyer');
export const selectShopOffer = (s: NegotiationState) => lastOffer(s, 'shop');
export const selectRound = currentRound;
