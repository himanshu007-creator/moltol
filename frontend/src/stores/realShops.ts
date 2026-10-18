import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { getPublicShop, nearbyShops, type NearbyShop, type PublicShopItem } from '@/lib/backend';
import type { InventoryItem, Shop } from '@/lib/mock/seeds';
import type { GeoPoint } from '@/lib/mock/discovery';

/**
 * Real backend shops near the buyer, fetched from `GET /v1/shops/nearby` and
 * shaped to look exactly like a seeded `Shop` (see `lib/mock/seeds.ts`) so
 * every downstream component (`StallGrid`, `CartSheet`, `bazaar.ts`) keeps
 * working generically — the only new thing is `backendShopId`/
 * `backendItemId`, which `bazaar.ts` checks to decide real vs. local haggle.
 * This is a plain coordinate fetch, not live tracking — see
 * `BE_MISSING_THINGS.md`'s "Live vendor location on the map" for why
 * continuous movement is a separate, not-yet-built feature.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Seeded demo shops use short slugs ('demo-01'); only a real shop id is a UUID. */
export function isRealShopId(id: string): boolean {
  return UUID_RE.test(id);
}

function mapPublicItem(it: PublicShopItem): InventoryItem {
  return {
    sku: it.id,
    // Not a real comps-library lookup key for this item — never used as one,
    // since `market` below (not COMP_LIB) is what compsOf() reads once it's
    // set. Picking any valid key just satisfies the type.
    itemId: 'tomato',
    // No comps band ships with the public shop listing, so centre a neutral
    // ±10% band on the item's own price — same "centre on list price"
    // fallback the backend itself uses once a real haggle starts (see
    // BE_MISSING_THINGS.md), rather than comparing a real vendor's item
    // against an unrelated seeded item's price.
    market: { median: it.sellCents, p25: Math.round(it.sellCents * 0.9), p75: Math.round(it.sellCents * 1.1) },
    title: { en: it.name },
    emoji: it.emoji ?? '🛒',
    unit: it.unit ?? 'piece',
    listCents: it.sellCents,
    floorCents: it.sellCents, // never read for a real item — the real floor stays sealed server-side
    stock: it.quantity ?? 999,
    backendItemId: it.id,
  };
}

function movedFar(a: GeoPoint | null, b: GeoPoint): boolean {
  if (!a) return true;
  const REFETCH_MIN_MOVE_M = 150;
  // Cheap planar approximation — fine at bazaar scale, avoids importing haversineM here.
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((b.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng) > REFETCH_MIN_MOVE_M;
}

function toShop(s: NearbyShop): Shop | null {
  if (!s.location) return null; // no location set yet — not discoverable on the map
  return {
    id: s.id,
    backendShopId: s.id,
    name: { en: s.name },
    kind: 'kirana',
    emoji: s.emoji,
    x: 0,
    y: 0,
    lat: s.location.lat,
    lng: s.location.lng,
    distanceM: s.distanceM,
    persona: (s.persona as Shop['persona']) || 'analyst',
    products: [], // fetched lazily on stall entry — see useRealShopProducts
  };
}

interface RealShopsState {
  shops: Shop[];
  fetchedAt: number;
  fetchedPoint: GeoPoint | null;
  fetchNearby: (point: GeoPoint) => Promise<void>;
}

const REFETCH_MIN_MS = 30_000;

export const useRealShops = create<RealShopsState>((set, get) => ({
  shops: [],
  fetchedAt: 0,
  fetchedPoint: null,
  fetchNearby: async (point) => {
    const { fetchedAt, fetchedPoint } = get();
    if (Date.now() - fetchedAt < REFETCH_MIN_MS && !movedFar(fetchedPoint, point)) return;
    set({ fetchedAt: Date.now(), fetchedPoint: point });
    try {
      const nearby = await nearbyShops(point.lat, point.lng);
      set({ shops: nearby.map(toShop).filter((s): s is Shop => s !== null) });
    } catch {
      // Backend unreachable — keep whatever was last fetched (possibly none);
      // seeded demo shops still show either way.
    }
  },
}));

/**
 * A real shop's products aren't merged in eagerly above (that would make
 * every nearby pin fetch its full item list). Fetched once on stall/cart
 * entry via the public, buyer-safe view (`floorCents` already stripped
 * server-side) and mapped into the same `InventoryItem` shape the seeded
 * catalogue uses, tagged with `backendItemId` so `bazaar.ts` knows to
 * haggle this lane for real. Returns `null` while loading/not-a-real-shop
 * (caller keeps the shop's existing products, e.g. `[]`) and `[]` only on a
 * genuine fetch failure.
 */
export function useRealShopProducts(shop: Shop | undefined): InventoryItem[] | null {
  const [products, setProducts] = useState<InventoryItem[] | null>(null);
  useEffect(() => {
    setProducts(null);
    if (!shop?.backendShopId) return;
    let cancelled = false;
    getPublicShop(shop.backendShopId)
      .then((full) => {
        if (!cancelled) setProducts(full.items.map(mapPublicItem));
      })
      .catch(() => setProducts([]));
    return () => {
      cancelled = true;
    };
  }, [shop?.backendShopId]);
  return products;
}

/**
 * Entering a stall URL directly — a shared link, a bookmark, or any hard
 * navigation — can land here before `useRealShops`' nearby fetch has ever
 * run (that store isn't persisted; it only fills in once the discovery page
 * mounts). If the id looks like a real shop (a UUID, never a seeded slug)
 * and isn't already in the live list, fetch it directly so the stall still
 * resolves. Returns `undefined` while loading or for a genuinely unknown id.
 */
export function useDirectShopFallback(stallId: string, foundInList: boolean): Shop | undefined {
  const [shop, setShop] = useState<Shop | undefined>(undefined);
  const needsFetch = !foundInList && isRealShopId(stallId);
  useEffect(() => {
    setShop(undefined);
    if (!needsFetch) return;
    let cancelled = false;
    getPublicShop(stallId)
      .then((full) => {
        if (cancelled) return;
        setShop({
          id: full.id,
          backendShopId: full.id,
          name: { en: full.name },
          kind: 'kirana',
          emoji: full.emoji,
          x: 0,
          y: 0,
          lat: full.location?.lat ?? 0,
          lng: full.location?.lng ?? 0,
          distanceM: 0,
          persona: (full.persona as Shop['persona']) || 'analyst',
          products: full.items.map(mapPublicItem),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stallId, needsFetch]);
  return shop;
}
