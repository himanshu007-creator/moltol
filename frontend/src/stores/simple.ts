import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '@/lib/idb';
import type { Locale, ItemId } from '@/lib/simple/strings';

export type SimpleUnit = 'kg' | '500g' | 'piece' | 'bunch';

export interface SimpleProduct {
  id: ItemId;
  sellCents: number;
  floorCents: number;
  /** optional — set when a product is created by the scanner/creation form */
  quantity?: number;
  unit?: SimpleUnit;
  hindiName?: string;
  /** bundled static asset path, e.g. /vegetables/potato.svg */
  image?: string;
  /** model/catalogue key the product was recognised as */
  vegKey?: string;
}

export type SimplePersona = 'charmer' | 'stoic' | 'storyteller';

export const DEFAULT_PRODUCTS: Record<ItemId, number> = {
  tomato: 4_000,
  onion: 3_000,
  potato: 3_000,
  coriander: 2_000,
  lemon: 1_000,
  chilli: 3_000,
  spinach: 2_000,
  carrot: 4_000,
  cauliflower: 3_000,
  cabbage: 2_500,
  brinjal: 3_500,
  cucumber: 3_000,
  capsicum: 6_000,
  okra: 4_500,
  garlic: 12_000,
  ginger: 9_000,
  peas: 8_000,
  banana: 5_000,
  apple: 12_000,
  orange: 7_000,
  mango: 15_000,
  cust: 0,
};

type HaggleStep = 'idle' | 'offer' | 'counter' | 'done' | 'waiting';
type HaggleOutcome = 'accepted' | 'refused' | null;

export interface LongDeal {
  ts: number;
  item: string;
  emoji: string;
  cents: number;
}

interface HaggleSession {
  step: HaggleStep;
  offerCents: number | null;
  lastOutcome: HaggleOutcome;
  dealCents: number | null;
  offerItem: string;
  offerEmoji: string;
}

interface SimpleStore {
  onboarded: boolean;
  language: Locale;
  phone: string;
  phoneVerified: boolean;
  stallName: string;
  stallEmoji: string;
  products: SimpleProduct[];
  persona: SimplePersona;
  mute: boolean;
  todayEarningsCents: number;
  dealsLog: LongDeal[];
  haggle: HaggleSession;

  setLanguage: (locale: Locale) => void;
  setPhone: (phone: string) => void;
  verifyPhone: () => void;
  setStall: (name: string, emoji: string) => void;
  setProducts: (products: SimpleProduct[]) => void;
  /** create (or update) a single listing — the shared product-creation path */
  addProduct: (product: SimpleProduct) => void;
  setPrice: (id: ItemId, sellCents: number, floorCents: number) => void;
  setPersona: (persona: SimplePersona) => void;
  finishOnboarding: () => void;
  /** Seed a ready-to-use demo stall, once (guarded by `onboarded`). Local, no-backend testing. */
  provisionDemo: () => void;
  toggleMute: () => void;
  reset: () => void;
  setHaggle: (h: Partial<HaggleSession>) => void;
  acceptDeal: (cents: number, item: string, emoji: string) => void;
}

const initialState = {
  onboarded: false,
  language: 'en' as Locale,
  phone: '',
  phoneVerified: false,
  stallName: '',
  stallEmoji: '🏪',
  products: [] as SimpleProduct[],
  persona: 'charmer' as SimplePersona,
  mute: false,
  todayEarningsCents: 0,
  dealsLog: [],
  haggle: { step: 'idle', offerCents: null, lastOutcome: null, dealCents: null, offerItem: '', offerEmoji: '🛒' } as HaggleSession,
};

export const useSimple = create<SimpleStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      setLanguage: (language) => set({ language }),
      setPhone: (phone) => set({ phone }),
      verifyPhone: () => set({ phoneVerified: true }),
      setStall: (stallName, stallEmoji) => set({ stallName, stallEmoji }),
      setProducts: (products) => set({ products }),
      addProduct: (product) =>
        set({
          products: get().products.some((p) => p.id === product.id)
            ? get().products.map((p) => (p.id === product.id ? { ...p, ...product } : p))
            : [...get().products, product],
        }),
      setPrice: (id, sellCents, floorCents) =>
        set({
          products: get().products.map((p) => (p.id === id ? { ...p, sellCents, floorCents } : p)),
        }),
      setPersona: (persona) => set({ persona }),
      finishOnboarding: () => set({ onboarded: true }),
      provisionDemo: () => {
        if (get().onboarded) return;
        const starter: ItemId[] = ['tomato', 'onion', 'potato', 'coriander'];
        set({
          onboarded: true,
          stallName: 'Demo ki Dukaan',
          stallEmoji: '🏪',
          products: starter.map((id) => ({ id, sellCents: DEFAULT_PRODUCTS[id], floorCents: Math.round((DEFAULT_PRODUCTS[id] * 0.75) / 100) * 100 })),
        });
      },
      toggleMute: () => set({ mute: !get().mute }),
      reset: () => set(initialState),
      setHaggle: (h) => set({ haggle: { ...get().haggle, ...h } }),
      acceptDeal: (cents, item, emoji) =>
        set({
          todayEarningsCents: get().todayEarningsCents + cents,
          dealsLog: [{ ts: Date.now(), item, emoji, cents }, ...get().dealsLog].slice(0, 30),
          haggle: { step: 'done', offerCents: null, lastOutcome: 'accepted', dealCents: cents, offerItem: item, offerEmoji: emoji },
        }),
    }),
    { name: 'moltol-simple', storage: createJSONStorage(() => idbStorage) },
  ),
);