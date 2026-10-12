import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '@/lib/idb';

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

export type PaymentStatus = 'order_created' | 'approved' | 'captured' | 'failed';

export interface Order {
  id: string;
  ts: number;
  shopId: string;
  shopName: string;
  shopEmoji: string;
  lines: OrderLine[];
  totalCents: number;
  marketCents: number;
  savingsCents: number;
  fairness: number;
  proofVerified: boolean;
  trackerIndex: number;
  etaMin: number;
  paymentStatus: PaymentStatus;
}

interface OrdersState {
  orders: Order[];
  create: (o: Omit<Order, 'ts' | 'trackerIndex' | 'proofVerified' | 'etaMin' | 'paymentStatus'>) => void;
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