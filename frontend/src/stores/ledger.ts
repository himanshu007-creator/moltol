import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '@/lib/idb';
import { seedDeals, type Deal } from '@/lib/ledger';
import { DEMO_STOCK } from '@/stores/inventory';

interface LedgerState {
  deals: Deal[];
  record: (deal: Deal) => void;
  reset: () => void;
}

/** Deal history for the vendor ledger. Seeded once (90 days), then persisted to IndexedDB. */
export const useLedger = create<LedgerState>()(
  persist(
    (set, get) => ({
      deals: seedDeals(DEMO_STOCK),
      record: (deal) => set({ deals: [deal, ...get().deals].slice(0, 5000) }),
      reset: () => set({ deals: seedDeals(DEMO_STOCK) }),
    }),
    { name: 'moltol-ledger', storage: createJSONStorage(() => idbStorage) },
  ),
);
