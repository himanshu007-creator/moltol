import { create } from 'zustand';
import { BAZAAR_CENTER, haversineM, type GeoPoint } from '@/lib/mock/discovery';
import { SHOPS, type Shop } from '@/lib/mock/seeds';

/**
 * Where the buyer is. One source for the map, the distance list and the
 * proximity prompt. `gps` = real position, `placed` = the "place me near a
 * shop" demo helper, `default` = bazaar centre before anything has happened.
 */
export type PosSource = 'default' | 'gps' | 'placed';

interface YouState {
  point: GeoPoint;
  source: PosSource;
  setGps: (p: GeoPoint) => void;
  /** Demo helper: teleport next to the real shops so the proximity prompt can
   *  be tried without being physically near Jalandhar. */
  placeNearShop: () => void;
}

/** a stall counts as "you are entering" inside this radius */
export const ENTER_RADIUS_M = 35;

export const useYou = create<YouState>()((set) => ({
  point: { ...BAZAAR_CENTER },
  source: 'default',

  setGps: (point) => set({ point, source: 'gps' }),

  placeNearShop: () => {
    const real = SHOPS.filter((s) => s.id === 'barry-01' || s.id === 'magan-01');
    const lat = real.reduce((sum, s) => sum + s.lat, 0) / real.length;
    const lng = real.reduce((sum, s) => sum + s.lng, 0) / real.length;
    set({ point: { lat, lng }, source: 'placed' });
  },
}));

/** Metres from a point to every shop in the list (seeded, real, or both — defaults to seeded only). */
export function distancesFrom(point: GeoPoint, shops: Shop[] = SHOPS): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of shops) out[s.id] = Math.round(haversineM(point, { lat: s.lat, lng: s.lng }));
  return out;
}
