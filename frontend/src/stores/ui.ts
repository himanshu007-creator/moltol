import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  undo?: () => void;
}

export interface Banner {
  text: string;
  actionLabel: string;
  onAction: () => void;
}

interface UiState {
  toasts: Toast[];
  banner: Banner | null;
  /** a brief full-screen "money credited" celebration — set once per payment, auto-clears */
  moneySplash: { amountCents: number } | null;
  push: (text: string, undo?: () => void) => void;
  dismiss: (id: number) => void;
  setBanner: (banner: Banner | null) => void;
  showMoneySplash: (amountCents: number) => void;
  clearMoneySplash: () => void;
}

let n = 0;

export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  banner: null,
  moneySplash: null,
  push: (text, undo) => {
    const id = ++n;
    set({ toasts: [...get().toasts, { id, text, undo }] });
    setTimeout(() => get().dismiss(id), 4000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setBanner: (banner) => set({ banner }),
  showMoneySplash: (amountCents) => {
    set({ moneySplash: { amountCents } });
    setTimeout(() => {
      if (get().moneySplash?.amountCents === amountCents) set({ moneySplash: null });
    }, 2000);
  },
  clearMoneySplash: () => set({ moneySplash: null }),
}));