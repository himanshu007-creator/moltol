import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import { navigate } from 'astro:transitions/client';
import { OSM_TILE_URL, OSM_ATTRIBUTION, type GeoPoint } from '@/lib/mock/discovery';
import { useI18n } from '@/stores/prefs';

interface Pin {
  id: string;
  name: string;
  emoji: string;
  lat: number;
  lng: number;
  open: boolean;
  meters: number;
}

const SATELLITE_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTRIBUTION = '&copy; Esri — Source: Esri, Maxar, Earthstar Geographics';

/** A real tile map (street or satellite): your avatar plus every shop pin, live distances in the popup. */
export default function LeafletMap({ point, pins, satellite = false }: { point: GeoPoint; pins: Pin[]; satellite?: boolean }) {
  const { locale } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<import('leaflet').Map | null>(null);
  const meMarker = useRef<import('leaflet').Marker | null>(null);
  const pinMarkers = useRef<Map<string, import('leaflet').Marker>>(new Map());
  const tileLayer = useRef<import('leaflet').TileLayer | null>(null);

  // mount once
  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !el.current || map.current) return;
      const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([point.lat, point.lng], 18);
      tileLayer.current = L.tileLayer(satellite ? SATELLITE_TILE_URL : OSM_TILE_URL, {
        attribution: satellite ? SATELLITE_ATTRIBUTION : OSM_ATTRIBUTION,
        maxZoom: 19,
      }).addTo(m);
      map.current = m;
      // interactive: false — it's a position indicator, not a control; Leaflet otherwise
      // gives every marker role="button"/tabindex, with no accessible name to go with it.
      meMarker.current = L.marker([point.lat, point.lng], { icon: meIcon(L), zIndexOffset: 1000, interactive: false, keyboard: false }).addTo(m);
      updatePins(L, m, pinMarkers.current, pins, locale);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // swap street ⇄ satellite tiles without rebuilding the whole map
  useEffect(() => {
    if (!map.current) return;
    void import('leaflet').then((L) => {
      if (!map.current) return;
      tileLayer.current?.remove();
      tileLayer.current = L.tileLayer(satellite ? SATELLITE_TILE_URL : OSM_TILE_URL, {
        attribution: satellite ? SATELLITE_ATTRIBUTION : OSM_ATTRIBUTION,
        maxZoom: 19,
      }).addTo(map.current);
      tileLayer.current.bringToBack();
    });
  }, [satellite]);

  // move the "you" marker, pan gently to keep it in view
  useEffect(() => {
    if (!meMarker.current || !map.current) return;
    meMarker.current.setLatLng([point.lat, point.lng]);
    if (!map.current.getBounds().contains([point.lat, point.lng])) {
      map.current.panTo([point.lat, point.lng]);
    }
  }, [point.lat, point.lng]);

  // keep pins in sync (open/closed flips, distance labels, locale)
  useEffect(() => {
    if (!map.current) return;
    void import('leaflet').then((L) => updatePins(L, map.current!, pinMarkers.current, pins, locale));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, locale]);

  return (
    <div
      ref={el}
      role="region"
      aria-label="Bazaar map"
      data-satellite={satellite ? '1' : undefined}
      className="leaflet-moltol h-72 w-full overflow-hidden rounded-3xl sm:h-96"
    />
  );
}

function meIcon(L: typeof import('leaflet')) {
  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:20px;height:20px;border-radius:9999px;border:3px solid var(--color-paper);background:var(--color-indigo);box-shadow:0 2px 6px rgba(0,0,0,.35)"></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function pinIcon(L: typeof import('leaflet'), p: Pin, closedLabel: string) {
  const ring = p.open ? 'border-color:var(--color-ink);background:var(--color-marigold)' : 'border-color:var(--color-chalk-strong);background:var(--color-paper-2);filter:grayscale(1);opacity:.7';
  const badge = p.open
    ? `<span style="background:var(--color-ink);color:var(--color-paper)" class="pin-badge">${Math.round(p.meters)} m</span>`
    : `<span style="background:var(--color-chili);color:#fff" class="pin-badge">${closedLabel}</span>`;
  return L.divIcon({
    className: '',
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-6px)">
        <span style="display:grid;place-items:center;width:44px;height:44px;border-radius:9999px;border:2px solid;font-size:22px;box-shadow:0 2px 6px rgba(0,0,0,.3);${ring}">${p.emoji}</span>
        <style>.pin-badge{margin-top:4px;border-radius:9999px;padding:2px 8px;font-size:11px;font-weight:700;white-space:nowrap}</style>
        ${badge}
      </div>`,
    iconSize: [44, 66],
    iconAnchor: [22, 66],
    popupAnchor: [0, -60],
  });
}

function updatePins(L: typeof import('leaflet'), m: import('leaflet').Map, cache: Map<string, import('leaflet').Marker>, pins: Pin[], locale: 'en' | 'hi') {
  const closedLabel = locale === 'hi' ? 'बंद' : 'Closed';
  const awayLabel = locale === 'hi' ? 'मी दूर' : 'm away';
  const seen = new Set<string>();
  for (const p of pins) {
    seen.add(p.id);
    let marker = cache.get(p.id);
    if (!marker) {
      marker = L.marker([p.lat, p.lng], { icon: pinIcon(L, p, closedLabel) }).addTo(m);
      marker.on('click', () => {
        void navigate(`/app/stall?id=${p.id}`);
      });
      cache.set(p.id, marker);
    } else {
      marker.setIcon(pinIcon(L, p, closedLabel));
    }
    marker.bindTooltip(`${p.name} · ${p.open ? `${Math.round(p.meters)} ${awayLabel}` : closedLabel}`, { direction: 'top', offset: [0, -60] });
  }
  for (const [id, marker] of cache) {
    if (!seen.has(id)) {
      marker.remove();
      cache.delete(id);
    }
  }
}
