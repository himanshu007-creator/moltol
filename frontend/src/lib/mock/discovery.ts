/**
 * Geolocation + free map discovery layer.
 * Real impl = browser GPS + an OSM/Leaflet map. Everything degrades to walking
 * distance + a stylized mock map when the user denies GPS or is offline.
 */

import { SHOPS } from './seeds';
import type { ProximityProvider } from './market';

export const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '&copy; OpenStreetMap contributors';

/** Centre of the demo bazaar: Jalandhar, between Barry vegetable shop and Cherry fruit shop. */
export const BAZAAR_CENTER = { lat: 31.2884, lng: 75.5968 };

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Great-circle distance in meters. */
export function haversineM(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Real GOS-backed proximity — replaces walkingProvider when GPS resolves. */
export function gpsProvider(you: GeoPoint): ProximityProvider {
  return {
    source: 'gps',
    distances: () => {
      const out: Record<string, number> = {};
      for (const s of SHOPS) {
        out[s.id] = Math.round(haversineM(you, { lat: s.lat, lng: s.lng }));
      }
      return out;
    },
  };
}