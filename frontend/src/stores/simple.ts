import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '@/lib/idb';
import type { Locale, ItemId } from '@/lib/simple/strings';
import type { ShopItem } from '@/lib/backend';

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
  /** the backend `shop_items` row this product is synced to, once it exists. */
  backendItemId?: string;
}

export type SimplePersona = 'charmer' | 'stoic' | 'storyteller';

const UNIT_MAP: Record<string, SimpleUnit> = { kg: 'kg', '500g': '500g', piece: 'piece', bunch: 'bunch' };

/**
 * A real backend item has no catalogue key — `id: 'cust'` is Simple Mode's
 * existing escape hatch for a free-named product (already used whenever a
 * seller types a name instead of picking from the vegetable catalogue), with
 * `hindiName` doing double duty as "the display name override" regardless of
 * language (see `SimplePrice.tsx`'s `item.hindiName || itemName(...)`).
 */
export function shopItemToSimpleProduct(item: ShopItem): SimpleProduct {
  return {
    id: 'cust',
    hindiName: item.name,
    sellCents: item.sellCents,
    floorCents: item.floorCents,
    quantity: item.quantity ?? undefined,
    unit: (item.unit && UNIT_MAP[item.unit]) || 'piece',
    backendItemId: item.id,
  };
}

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