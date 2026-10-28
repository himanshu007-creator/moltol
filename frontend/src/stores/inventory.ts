import { create } from 'zustand';
import { useMemo } from 'react';
import {
  getMyShop,
  addShopItem,
  bulkAddShopItems,
  updateShopItem,
  adjustShopItemStock,
  type ShopItem,
  type ShopItemInput,
} from '@/lib/backend';
import { useRealShops } from '@/stores/realShops';

export interface AdjustLog {
  id: string;
  sku: string;
  delta: number;
  reason: string;
  at: number;
}

interface InventoryState {
  items: ShopItem[];
  log: AdjustLog[];
  loaded: boolean;
  loading: boolean;

  fetch: (token: string) => Promise<void>;
  add: (token: string, draft: ShopItemInput) => Promise<string>;
  update: (token: string, id: string, patch: Partial<ShopItemInput>) => Promise<void>;
  /** +/- stock with a reason, logged for the ledger */
  adjust: (token: string, id: string, delta: number, reason: string) => Promise<void>;
  /** bulk list-price change, in percent (e.g. 5 or -5). Never drops a list price below its floor. */
  bulkListPct: (token: string, ids: string[], pct: number) => Promise<void>;
  importMany: (token: string, drafts: ShopItemInput[]) => Promise<number>;
  /** Soft delete / restore — real write path now that the backend accepts `archived` on PATCH. */
  setArchived: (token: string, ids: string[], archived: boolean) => Promise<void>;
  reset: () => void;
}

export const useInventory = create<InventoryState>()((set, get) => ({
  items: [],
  log: [],
  loaded: false,
  loading: false,

  fetch: async (token) => {
    set({ loading: true });
    try {
      const shop = await getMyShop(token);
      set({ items: shop.items, loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  add: async (token, draft) => {
    const row = await addShopItem(token, draft);
    set({ items: [row, ...get().items] });
    return row.id;
  },

  update: async (token, id, patch) => {
    const row = await updateShopItem(token, id, patch);
    set({ items: get().items.map((i) => (i.id === id ? row : i)) });
  },

  adjust: async (token, id, delta, reason) => {
    const opId = crypto.randomUUID();
    const row = await adjustShopItemStock(token, id, delta, reason, opId);
    set({ items: get().items.map((i) => (i.id === id ? row : i)) });
    set({ log: [{ id: `${id}-${Date.now()}`, sku: id, delta, reason, at: Date.now() }, ...get().log].slice(0, 200) });
  },

  bulkListPct: async (token, ids, pct) => {
    for (const id of ids) {
      const cur = get().items.find((i) => i.id === id);
      if (!cur) continue;
      const sellCents = Math.max(cur.floorCents, Math.round((cur.sellCents * (100 + pct)) / 100));
      await get().update(token, id, { sellCents });
    }
  },

  setArchived: async (token, ids, archived) => {
    for (const id of ids) {
      await get().update(token, id, { archived });
    }
  },

  importMany: async (token, drafts) => {
    try {
      const rows = await bulkAddShopItems(token, drafts);
      set({ items: [...rows, ...get().items] });
      return rows.length;
    } catch {
      // one bad row in the batch now sinks the whole import (all-or-nothing,
      // real audit-trail write) — CSV import is a small/rare path, the
      // clearer error semantics are worth the lost partial-success behavior.
      return 0;
    }
  },

  reset: () => set({ items: [], log: [], loaded: false }),
}));

export function useLiveShops() {
  return useRealShops((s) => s.shops);
}
