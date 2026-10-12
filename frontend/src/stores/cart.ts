import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '@/lib/idb';
import type { I18nName } from '@/lib/mock/seeds';

export interface CartLine {
  sku: string;
  shopId: string;
  title: I18nName;
  emoji: string;
  unit: string;
  listCents: number;
  qty: number;
  stock: number;
}

interface CartState {
  lines: CartLine[];
  shopId: string | null;
  add: (line: CartLine) => void;
  setQty: (sku: string, qty: number) => void;
  remove: (sku: string) => void;
  clear: () => void;
  totalCents: () => number;
  lineCount: () => number;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      shopId: null,
      add: (line) => {
        const existing = get().lines.find((l) => l.sku === line.sku);
        if (existing) {
          set({
            lines: get().lines.map((l) =>
              l.sku === line.sku ? { ...l, qty: Math.min(l.stock, l.qty + 1) } : l,
            ),
          });
        } else {
          set({ lines: [...get().lines, line], shopId: line.shopId });
        }
      },
      setQty: (sku, qty) =>
        set({
          lines: qty <= 0
            ? get().lines.filter((l) => l.sku !== sku)
            : get().lines.map((l) => (l.sku === sku ? { ...l, qty: Math.min(l.stock, qty) } : l)),
        }),
      remove: (sku) => set({ lines: get().lines.filter((l) => l.sku !== sku) }),
      clear: () => set({ lines: [], shopId: null }),
      totalCents: () => Math.round(get().lines.reduce((sum, l) => sum + l.listCents * l.qty, 0)),
      lineCount: () => get().lines.reduce((sum, l) => sum + l.qty, 0),
    }),
    { name: 'moltol-cart', storage: createJSONStorage(() => idbStorage) },
  ),
);

export function useCartLineCount(): number {
  return useCart((s) => s.lines.reduce((sum, l) => sum + l.qty, 0));
}