import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useMemo } from 'react';
import { idbStorage } from '@/lib/idb';
import { SHOPS, type Shop } from '@/lib/mock/seeds';
import { toBuyerItems, type StockItem } from '@/lib/inventory';
import { clampQty, type UnitId } from '@/lib/units';
import { DEMO_SLOT_ID } from '@/stores/venue';

/** The demo seller's stall. Its buyer-facing products come from this store. */

export const DEMO_STOCK: StockItem[] = [
  item('de-tom', 'Tomatoes', '🍅', 'vegetable', 'kg', 24, 2500, 2800, 4000, 'tomato'),
  item('de-oni', 'Onions', '🧅', 'vegetable', 'kg', 30, 2400, 3000, 3500, 'onion'),
  item('de-pot', 'Potatoes', '🥔', 'vegetable', 'kg', 40, 2200, 2500, 3500, 'potato'),
  item('de-cor', 'Coriander', '🌿', 'vegetable', 'bunch', 12, 1000, 1200, 2000, 'coriander'),
  item('de-lem', 'Lemons', '🍋', 'vegetable', 'piece', 60, 400, 500, 1000, 'lemon'),
  item('de-egg', 'Eggs', '🥚', 'dairy', 'dozen', 8, 6000, 6600, 7500),
  item('de-mlk', 'Milk', '🥛', 'dairy', 'litre', 20, 5200, 5600, 6200, 'milk'),
  item('de-oil', 'Mustard oil pouch', '🫒', 'grocery', 'pack', 5, 15000, 16500, 18500, 'oil', 1000),
  item('de-ata', 'Whole-wheat atta', '🌾', 'grocery', 'kg', 50, 2500, 2800, 3200),
  item('de-dal', 'Moong dal', '🫘', 'grocery', 'kg', 15, 9500, 11000, 12500, 'dal'),
  item('de-chi', 'Green chilli (100 g pack)', '🌶️', 'vegetable', 'pack', 12, 600, 800, 1000, 'chilli', 100),
  item('de-ban', 'Bananas', '🍌', 'fruit', 'dozen', 10, 4000, 4800, 6000, 'banana'),
];

function item(
  id: string,
  name: string,
  emoji: string,
  category: string,
  unit: UnitId,
  qty: number,
  costCents: number,
  minCents: number,
  listCents: number,
  compKey?: string,
  packSize?: number,
): StockItem {
  return { id, name, emoji, category, unit, qty, costCents, minCents, listCents, compKey, packSize, lowStockAt: 5, archived: false, updatedAt: 0 };
}

export interface AdjustLog {
  id: string;
  sku: string;
  delta: number;
  reason: string;
  at: number;
}

export type NewItem = Omit<StockItem, 'id' | 'archived' | 'updatedAt'>;

interface UndoEntry {
  label: string;
  items: StockItem[];
}

interface InventoryState {
  items: StockItem[];
  log: AdjustLog[];
  undo: UndoEntry | null;

  add: (draft: NewItem) => string;
  update: (id: string, patch: Partial<NewItem>) => void;
  /** +/- stock with a reason, logged for the ledger */
  adjust: (id: string, delta: number, reason: string) => void;
  setArchived: (ids: string[], archived: boolean) => void;
  /** bulk list-price change, in percent (e.g. 5 or -5). Never drops a list price below its min. */
  bulkListPct: (ids: string[], pct: number) => void;
  importMany: (drafts: NewItem[]) => number;
  runUndo: () => void;
  dismissUndo: () => void;
  resetDemo: () => void;
}

function remember(state: InventoryState, label: string): Partial<InventoryState> {
  return { undo: { label, items: state.items } };
}

export const useInventory = create<InventoryState>()(
  persist(
    (set, get) => ({
      items: DEMO_STOCK,
      log: [],
      undo: null,

      add: (draft) => {
        const id = `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const row: StockItem = { ...draft, qty: clampQty(draft.qty, draft.unit), id, archived: false, updatedAt: Date.now() };
        set({ items: [row, ...get().items], ...remember(get(), `Added ${row.name}`) });
        return id;
      },

      update: (id, patch) =>
        set({
          items: get().items.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: Date.now() } : i)),
          ...remember(get(), 'Edited item'),
        }),

      adjust: (id, delta, reason) => {
        const cur = get().items.find((i) => i.id === id);
        if (!cur) return;
        const qty = clampQty(Math.max(0, cur.qty + delta), cur.unit);
        set({
          items: get().items.map((i) => (i.id === id ? { ...i, qty, updatedAt: Date.now() } : i)),
          log: [{ id: `${id}-${Date.now()}`, sku: id, delta, reason, at: Date.now() }, ...get().log].slice(0, 200),
          ...remember(get(), `${cur.name} ${delta > 0 ? '+' : ''}${delta}`),
        });
      },

      setArchived: (ids, archived) =>
        set({
          items: get().items.map((i) => (ids.includes(i.id) ? { ...i, archived, updatedAt: Date.now() } : i)),
          ...remember(get(), archived ? `Archived ${ids.length}` : `Restored ${ids.length}`),
        }),

      bulkListPct: (ids, pct) =>
        set({
          items: get().items.map((i) => {
            if (!ids.includes(i.id)) return i;
            const next = Math.max(i.minCents, Math.round((i.listCents * (100 + pct)) / 100));
            return { ...i, listCents: next, updatedAt: Date.now() };
          }),
          ...remember(get(), `List prices ${pct > 0 ? '+' : ''}${pct}%`),
        }),

      importMany: (drafts) => {
        const rows: StockItem[] = drafts.map((d, n) => ({
          ...d,
          qty: clampQty(d.qty, d.unit),
          id: `csv-${Date.now().toString(36)}-${n}`,
          archived: false,
          updatedAt: Date.now(),
        }));
        set({ items: [...rows, ...get().items], ...remember(get(), `Imported ${rows.length}`) });
        return rows.length;
      },

      runUndo: () => {
        const u = get().undo;
        if (u) set({ items: u.items, undo: null });
      },
      dismissUndo: () => set({ undo: null }),
      resetDemo: () => set({ items: DEMO_STOCK, log: [], undo: null }),
    }),
    { name: 'moltol-inventory', storage: createJSONStorage(() => idbStorage) },
  ),
);

/**
 * Seeds with the demo stall's products replaced by the live inventory.
 * Other shops keep their seeded products.
 */
export function liveShops(items: StockItem[]): Shop[] {
  return SHOPS.map((s) => (s.id === DEMO_SLOT_ID ? { ...s, products: toBuyerItems(items) } : s));
}

export function useLiveShops(): Shop[] {
  const items = useInventory((s) => s.items);
  return useMemo(() => liveShops(items), [items]);
}
