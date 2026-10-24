/**
 * Shared domain types for a shop and its items. No seeded/mock data lives
 * here — this is the real shape, whether a `Shop`/`InventoryItem` came from
 * the real backend (`backendShopId`/`backendItemId` set) or not.
 */

export interface I18nName {
  en: string;
}

export type ShopKind = 'thela' | 'kirana' | 'fruit';
export type Persona = 'charmer' | 'stoic' | 'storyteller' | 'analyst';

export interface InventoryItem {
  /** stable key/SKU — for a real item, the backend's `shop_items.id`. */
  sku: string;
  /**
   * A seeded-catalogue comps-lookup key (`'tomato'`, etc.) — mock-market
   * only, never actually read for a real item (which always carries its
   * own `market` band instead; real items set this to an arbitrary valid
   * string purely to satisfy the type). Untyped here rather than a closed
   * union, since the real catalogue it indexes is itself mock data due to
   * be deleted.
   */
  itemId: string;
  title: I18nName;
  emoji: string;
  unit: string;
  listCents: number;
  /** seller-only red line — hidden from buyer UI entirely */
  floorCents: number;
  stock: number;
  /** market band shown in comps — real items always carry their own, never a shared lookup table. */
  market?: { median: number; p25: number; p75: number };
  /**
   * The real backend `shop_items.id` (UUID). Its presence (alongside the
   * parent `Shop.backendShopId`) is what tells `bazaar.ts` this lane is a
   * real basket line, not a stand-in.
   */
  backendItemId?: string;
}

export interface Shop {
  id: string;
  name: I18nName;
  kind: ShopKind;
  emoji: string;
  /** normalized map coords (0..100) — unused once the map projects real lat/lng only. */
  x: number;
  y: number;
  lat: number;
  lng: number;
  distanceM: number;
  persona: Persona;
  products: InventoryItem[];
  /** cross-item tactic UI: "buy both, save" — a seeded-only feature, never set by a real shop. */
  bundle?: { skus: [string, string]; discountCents: number };
  /** The real backend `shops.id` (UUID). */
  backendShopId?: string;
  /** epoch ms the vendor's location was last pushed — null/undefined when never shared live. */
  locationUpdatedAt?: number | null;
}
