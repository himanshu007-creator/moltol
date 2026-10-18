import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '@/lib/idb';
import type { BackendOrder } from '@/lib/backend';

export interface OrderLine {
  sku: string;
  title: string;
  emoji: string;
  unit: string;
  qty: number;
  unitCents: number;
  noDeal?: boolean;
}

export const TRACKER_STEPS = ['Confirmed', 'Packing', 'Ready'] as const;
export type TrackerStep = (typeof TRACKER_STEPS)[number];

export type PaymentStatus = 'order_created' | 'approved' | 'captured' | 'failed' | 'refunded';

export interface Order {
  id: string;
  ts: number;
  shopId: string;
  shopName: string;
  shopEmoji: string;
  lines: OrderLine[];
  totalCents: number;
  /** Sticker/list total of the closed lines — only known for a real backend order. */
  listCents?: number;
  marketCents: number;
  savingsCents: number;
  fairness: number;
  proofVerified: boolean;
  trackerIndex: number;
  etaMin: number;
  paymentStatus: PaymentStatus;
}

/** Map the backend's own `Order` (`GET /v1/orders`) into this store's shape — built deliberately to match, field for field. */
export function fromBackendOrder(o: BackendOrder): Order {
  return {
    id: o.id,
    ts: new Date(o.ts).getTime(),
    shopId: o.shopId,
    shopName: o.shopName,
    shopEmoji: o.shopEmoji,
    lines: o.lines.map((l) => ({
      sku: l.lineItemId,
      title: l.title,
      emoji: l.emoji ?? '🛒',
      unit: l.unit ?? '',
      qty: l.qty,
      unitCents: l.unitCents ?? 0,
      noDeal: l.noDeal,
    })),
    totalCents: o.totalCents,
    listCents: o.listCents,
    marketCents: o.marketCents,
    savingsCents: o.savingsCents,
    fairness: o.fairness ?? 0,
    proofVerified: o.proofVerified,
    trackerIndex: 0,
    etaMin: 25,
    paymentStatus: o.paymentStatus,
  };
}

interface OrdersState {
  orders: Order[];
  create: (o: Omit<Order, 'ts' | 'trackerIndex' | 'proofVerified' | 'etaMin' | 'paymentStatus'>) => void;
  /** Insert or replace a real backend order by id — additive to the local-only demo orders. */
  upsert: (o: Order) => void;
  tick: () => void;
  markProof: (id: string) => void;
  setPaymentStatus: (id: string, status: PaymentStatus) => void;
  reset: () => void;
}

export const useOrders = create<OrdersState>()(
  persist(
    (set, get) => ({
      orders: [],
      create: (o) =>
        set({
          orders: [
            {
              ...o,
              ts: Date.now(),
              trackerIndex: 0,
              proofVerified: false,
              etaMin: 25,
              paymentStatus: 'order_created' as const,
            },
            ...get().orders,
          ].slice(0, 20),
        }),
      upsert: (o) =>
        set({
          orders: [o, ...get().orders.filter((x) => x.id !== o.id)].sort((a, b) => b.ts - a.ts),
        }),
      tick: () =>
        set({
          orders: get().orders.map((o) =>
            o.trackerIndex < TRACKER_STEPS.length - 1 ? { ...o, trackerIndex: o.trackerIndex + 1 } : o,
          ),
        }),
      markProof: (id) =>
        set({ orders: get().orders.map((o) => (o.id === id ? { ...o, proofVerified: true } : o)) }),
      setPaymentStatus: (id, paymentStatus) =>
        set({ orders: get().orders.map((o) => (o.id === id ? { ...o, paymentStatus } : o)) }),
      reset: () => set({ orders: [] }),
    }),
    { name: 'moltol-orders', storage: createJSONStorage(() => idbStorage) },
  ),
);
