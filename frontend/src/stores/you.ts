import { create } from 'zustand';
import { haversineM, type GeoPoint } from '@/lib/geo';
import type { Shop } from '@/lib/types';

/**
 * Where the buyer is. One source for the map, the distance list and the
 * proximity prompt. There is no fallback "bazaar centre" — real shops can be
 * anywhere, so a position is either a real GPS fix or nothing yet.
 */
export type PosSource = 'locating' | 'gps' | 'denied' | 'manual';

interface YouState {
  point: GeoPoint | null;
  source: PosSource;
  setGps: (p: GeoPoint) => void;
  setDenied: () => void;
  /** A buyer-chosen point (typed place search) — used when GPS is denied, slow, or wrong. */
  setManual: (p: GeoPoint) => void;
}

/** a stall counts as "you are entering" inside this radius */
export const ENTER_RADIUS_M = 35;

export const useYou = create<YouState>()((set) => ({
  point: null,
  source: 'locating',

  setGps: (point) => set({ point, source: 'gps' }),
  setDenied: () => set({ source: 'denied' }),
  setManual: (point) => set({ point, source: 'manual' }),
}));

/** Metres from a point to every shop in the list. */
export function distancesFrom(point: GeoPoint, shops: Shop[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of shops) out[s.id] = Math.round(haversineM(point, { lat: s.lat, lng: s.lng }));
  return out;
}
