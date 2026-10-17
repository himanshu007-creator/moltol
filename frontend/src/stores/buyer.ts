import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '@/lib/idb';
import type { PresetId } from '@/lib/personality';
import { setHagglePreset } from '@/lib/backend';
import { useSession } from '@/stores/session';

interface BuyerState {
  /** the saved default haggle style; a single haggle can override it */
  personality: PresetId;
  setPersonality: (p: PresetId) => void;
  reset: () => void;
}

export const useBuyer = create<BuyerState>()(
  persist(
    (set) => ({
      personality: 'balanced',
      setPersonality: (personality) => {
        set({ personality });
        // View preference only, additive — never blocks the local pick.
        const token = useSession.getState().token;
        if (token) void setHagglePreset(token, personality).catch(() => {});
      },
      reset: () => set({ personality: 'balanced' }),
    }),
    { name: 'moltol-buyer', storage: createJSONStorage(() => idbStorage) },
  ),
);
