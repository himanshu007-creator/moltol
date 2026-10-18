import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '@/lib/idb';
import { SHOPS } from '@/lib/mock/seeds';

/** The demo seller's own stall: the one the vendor header and Simple Mode toggle. */
export const DEMO_SLOT_ID = 'demo-01';

export interface StallStatus {
  open: boolean;
  /** epoch ms: close automatically at this time */
  closeAt?: number | null;
  /** epoch ms: reopen automatically at this time */
  reopenAt?: number | null;
}

export type StallMap = Record<string, StallStatus>;

const CHANNEL = 'moltol-venue';

// Demo sync: every tab shares this store, so a seller window and a buyer window
// update live. Remote updates go through setState so they are not re-broadcast.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;

function seedStalls(): StallMap {
  const out: StallMap = {};
  for (const s of SHOPS) out[s.id] = { open: true };
  return out;
}

export interface VenueState {
  /** every stall in the bazaar + whether it's open for discovery right now */
  stalls: StallMap;
  setOpen: (shopId: string, open: boolean) => void;
  toggle: (shopId: string) => void;
  /** close in N minutes; clears any pending reopen */
  closeIn: (shopId: string, minutes: number) => void;
  /** reopen in N minutes (only while closed) */
  reopenIn: (shopId: string, minutes: number) => void;
  /** apply timers that have come due. Runs once a second from `startVenueClock`. */
  tick: (now?: number) => void;
  reset: () => void;
}

export const useVenue = create<VenueState>()(
  persist(
    (set, get) => {
      const commit = (stalls: StallMap) => {
        set({ stalls });
        channel?.postMessage(stalls);
      };
      const patch = (shopId: string, p: Partial<StallStatus>) => {
        const cur = get().stalls[shopId] ?? { open: true };
        commit({ ...get().stalls, [shopId]: { ...cur, ...p } });
      };
      return {
        stalls: seedStalls(),
        setOpen: (shopId, open) => patch(shopId, { open, closeAt: null, reopenAt: null }),
        toggle: (shopId) => {
          const open = get().stalls[shopId]?.open ?? true;
          patch(shopId, { open: !open, closeAt: null, reopenAt: null });
        },
        closeIn: (shopId, minutes) => patch(shopId, { open: true, closeAt: Date.now() + minutes * 60_000, reopenAt: null }),
        reopenIn: (shopId, minutes) => patch(shopId, { open: false, reopenAt: Date.now() + minutes * 60_000, closeAt: null }),
        tick: (now = Date.now()) => {
          let changed = false;
          const next: StallMap = { ...get().stalls };
          for (const [id, st] of Object.entries(next)) {
            if (st.open && st.closeAt && now >= st.closeAt) {
              next[id] = { ...st, open: false, closeAt: null };
              changed = true;
            } else if (!st.open && st.reopenAt && now >= st.reopenAt) {
              next[id] = { ...st, open: true, reopenAt: null };
              changed = true;
            }
          }
          if (changed) commit(next);
        },
        reset: () => commit(seedStalls()),
      };
    },
    { name: 'moltol-venue', storage: createJSONStorage(() => idbStorage) },
  ),
);

channel?.addEventListener('message', (e: MessageEvent<StallMap>) => useVenue.setState({ stalls: e.data }));

let clock: ReturnType<typeof setInterval> | null = null;
/** Start the timer clock once per page. Safe to call from every island. */
export function startVenueClock() {
  if (clock || typeof window === 'undefined') return;
  clock = setInterval(() => useVenue.getState().tick(), 1000);
}

let statusStream: EventSource | null = null;
/**
 * Live `shop.status` fan-out for real backend shops (`GET
 * /v1/shops/status/stream`), merged into the same `stalls` map the seeded
 * demo shops already use via `BroadcastChannel` — `isOpen()`/`splitNearby()`
 * need no changes. Additive and silent if the backend isn't configured.
 * Start once per page, alongside `startVenueClock()`.
 */
export function startShopStatusStream() {
  if (statusStream || typeof window === 'undefined') return;
  const base = import.meta.env.PUBLIC_BACKEND_BASE as string | undefined;
  if (!base) return;
  const source = new EventSource(`${base}/v1/shops/status/stream`);
  source.onmessage = (ev) => {
    try {
      const frame = JSON.parse(ev.data as string) as { t: 'shop.status'; shopId: string; status: StallStatus };
      if (frame.t !== 'shop.status') return;
      useVenue.setState((s) => ({ stalls: { ...s.stalls, [frame.shopId]: frame.status } }));
    } catch {
      /* ignore malformed frame */
    }
  };
  // No manual close/retry on error — EventSource reconnects natively using
  // the backend's own `retry:` hint, same as the basket stream.
  statusStream = source;
}

/** Open right now for buyers. Missing entries count as open. */
export function isOpen(stalls: StallMap, shopId: string): boolean {
  return stalls[shopId]?.open !== false;
}

/** Nearby ordering: open stalls by distance; closed stalls are listed apart and never ranked. */
export function splitNearby<T extends { id: string }>(shops: T[], stalls: StallMap, dists: Record<string, number>) {
  const open = shops.filter((s) => isOpen(stalls, s.id)).sort((a, b) => (dists[a.id] ?? 1e9) - (dists[b.id] ?? 1e9));
  const closed = shops.filter((s) => !isOpen(stalls, s.id));
  return { open, closed };
}
