import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { navigate } from 'astro:transitions/client';
import { useVenue, splitNearby } from '@/stores/venue';
import { useLiveShops } from '@/stores/inventory';
import { useRealShops } from '@/stores/realShops';
import { useYou, distancesFrom, ENTER_RADIUS_M } from '@/stores/you';
import { haversineM, type GeoPoint } from '@/lib/geo';
import { useI18n } from '@/stores/prefs';
import LeafletMap from '@/components/discovery/LeafletMap';

/** GPS waits this long for a first fix, then falls back to "off". */
const GPS_TIMEOUT_MS = 8000;

/**
 * Nearby discovery. One position store drives the map, the distance order and
 * the proximity prompt. There's no fallback centre — real shops can be
 * anywhere, so until the browser gives a real GPS fix, there's nothing to
 * show distances against.
 */
export default function ShopDiscovery() {
  const { t } = useI18n();
  const stalls = useVenue((s) => s.stalls);
  const shops = useLiveShops();
  const point = useYou((s) => s.point);
  const source = useYou((s) => s.source);
  const setGps = useYou((s) => s.setGps);
  const setDenied = useYou((s) => s.setDenied);

  const [watchKey, setWatchKey] = useState(0);
  // "Not now" silences the prompt until the buyer has moved at least 50 m from where they dismissed it
  const [dismissedAt, setDismissedAt] = useState<GeoPoint | null>(null);
  const [picking, setPicking] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const quiet = point !== null && dismissedAt !== null && haversineM(point, dismissedAt) < 50;
  const fetchNearby = useRealShops((s) => s.fetchNearby);

  // real backend shops near the buyer, once a real position exists (fails
  // silently if the backend is unreachable — useLiveShops() just stays empty)
  useEffect(() => {
    if (point) void fetchNearby(point);
  }, [point, fetchNearby]);

  // live GPS when the browser allows it; a timeout ends "locating" either way
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setDenied();
      return;
    }
    const timer = setTimeout(setDenied, GPS_TIMEOUT_MS);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        clearTimeout(timer);
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        setDenied();
      },
      { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 15_000 },
    );
    return () => {
      clearTimeout(timer);
      navigator.geolocation.clearWatch(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, setGps, setDenied]);

  const dists = useMemo(() => (point ? distancesFrom(point, shops) : {}), [point, shops]);
  const { open: sorted, closed } = useMemo(() => splitNearby(shops, stalls, dists), [shops, stalls, dists]);

  // every open shop you're standing next to, nearest first — not just one
  const nearbyList = useMemo(
    () => (!point || quiet ? [] : sorted.filter((s) => (dists[s.id] ?? Infinity) <= ENTER_RADIUS_M)),
    [point, quiet, sorted, dists],
  );

  const pins = [
    ...sorted.map((s) => ({ id: s.id, name: s.name.en, emoji: s.emoji, lat: s.lat, lng: s.lng, open: true, meters: dists[s.id] ?? 0 })),
    ...closed.map((s) => ({ id: s.id, name: s.name.en, emoji: s.emoji, lat: s.lat, lng: s.lng, open: false, meters: dists[s.id] ?? 0 })),
  ];

  const statusLine =
    source === 'gps'
      ? t('discovery.status.gps')
      : source === 'locating'
        ? t('discovery.status.locating')
        : t('discovery.status.off');

  const enterShop = (id: string) => {
    setPicking(false);
    void navigate(`/app/stall?id=${id}`);
  };

  if (!point) {
    return (
      <div className="surface grid justify-items-center gap-4 p-10 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-3xl bg-paper-3 text-4xl" aria-hidden="true">📍</span>
        <div>
          <p className="t-h2">{statusLine}</p>
          {source === 'denied' && <p className="mt-1 text-ink-muted">{t('discovery.shareLocation')}</p>}
        </div>
        {source === 'denied' && (
          <button type="button" onClick={() => setWatchKey((k) => k + 1)} className="btn btn-primary">
            {t('discovery.tryGps')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <section className="surface grid gap-3 p-3 sm:p-4 lg:sticky lg:top-24" aria-label="Map">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
          <span aria-live="polite">{statusLine}</span>
          <span className="pill">source: {source}</span>
        </div>

        <LeafletMap point={point} pins={pins} satellite={satellite} />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSatellite((v) => !v)}
            aria-pressed={satellite}
            className="btn btn-quiet !min-h-11 !px-4 !text-sm transition active:scale-95"
          >
            {satellite ? t('discovery.street') : t('discovery.satellite')}
          </button>
        </div>
      </section>

      <div className="grid gap-4">
        {sorted.length === 0 ? (
          <p className="surface p-6 text-center text-ink-muted">{t('discovery.noneOpen')}</p>
        ) : (
          <ul className="grid gap-3" data-testid="open-stalls">
            {sorted.map((s) => (
              <li key={s.id}>
                <a href={`/app/stall?id=${s.id}`} className="surface flex min-h-20 items-center gap-4 p-4 transition hover:-translate-y-0.5 active:scale-[0.99]">
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-paper-3 text-3xl" aria-hidden="true">{s.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="t-h2 block !text-[1.15rem]">{s.name.en}</span>
                    <span className="block text-sm text-ink-muted">
                      {Math.round(dists[s.id] ?? 0)} m · {s.persona}
                    </span>
                  </span>
                  <LiveBadge updatedAt={s.locationUpdatedAt} />
                  <span className="pill pill-teal">{t('discovery.open')}</span>
                  <span className="text-chili" aria-hidden="true">→</span>
                </a>
              </li>
            ))}
          </ul>
        )}

        {closed.length > 0 && (
          <section aria-labelledby="closed-heading" className="grid gap-3">
            <h2 id="closed-heading" className="t-label">{t('discovery.closedNow')}</h2>
            <ul className="grid gap-3" data-testid="closed-stalls">
              {closed.map((s) => (
                <li key={s.id}>
                  <a href={`/app/stall?id=${s.id}`} className="surface-soft flex min-h-20 items-center gap-4 p-4 opacity-80">
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-paper-3 text-3xl grayscale" aria-hidden="true">{s.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="t-h2 block !text-[1.15rem]">{s.name.en}</span>
                      <span className="block text-sm text-ink-muted">{s.persona}</span>
                    </span>
                    <span className="pill pill-chili">{t('discovery.closed')}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <AnimatePresence>
        {nearbyList.length === 1 && (
          <ProximityPrompt
            key="prox-single"
            name={nearbyList[0].name.en}
            emoji={nearbyList[0].emoji}
            meters={dists[nearbyList[0].id] ?? 0}
            onEnter={() => enterShop(nearbyList[0].id)}
            onLater={() => setDismissedAt(point)}
          />
        )}

        {nearbyList.length > 1 && !picking && (
          <ProximityPrompt
            key="prox-multi"
            name={`${nearbyList.length} ${t('discovery.prox.shops')}`}
            emoji="🧭"
            meters={dists[nearbyList[0].id] ?? 0}
            multi
            onEnter={() => setPicking(true)}
            onLater={() => setDismissedAt(point)}
          />
        )}

        {nearbyList.length > 1 && picking && (
          <ShopPicker key="picker" shops={nearbyList} dists={dists} onPick={enterShop} onClose={() => setPicking(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

/** A small "live" pill when a shop's pin moved recently — silent otherwise. */
const LIVE_FRESH_MS = 2 * 60_000;
function LiveBadge({ updatedAt }: { updatedAt?: number | null }) {
  if (!updatedAt || Date.now() - updatedAt > LIVE_FRESH_MS) return null;
  return <span className="pill pill-marigold">📡 live</span>;
}

const promptMotion = {
  initial: { opacity: 0, y: 24, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 16, scale: 0.97 },
  transition: { type: 'spring' as const, stiffness: 320, damping: 26 },
};

/** Shown when the buyer is inside a stall's radius. Says where they are and offers to enter. */
export function ProximityPrompt({
  name,
  emoji,
  meters,
  onEnter,
  onLater,
  multi,
}: {
  name: string;
  emoji: string;
  meters: number;
  onEnter: () => void;
  onLater: () => void;
  multi?: boolean;
}) {
  const { t } = useI18n();
  return (
    <motion.div
      {...promptMotion}
      role="alertdialog"
      aria-labelledby="prox-title"
      aria-describedby="prox-body"
      className="surface-solid fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-50 mx-auto grid max-w-md gap-3 p-4 sm:bottom-24"
    >
      <div className="flex items-center gap-3">
        <motion.span
          className="text-3xl"
          aria-hidden="true"
          initial={{ scale: 0.6, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.08 }}
        >
          {emoji}
        </motion.span>
        <div className="min-w-0">
          <p id="prox-title" className="text-lg font-bold text-ink">{multi ? t('discovery.prox.near') : t('discovery.prox.at')} {name}</p>
          <p id="prox-body" className="text-sm text-ink-muted">
            {multi ? t('discovery.prox.chooseHint') : `${Math.round(meters)} ${t('discovery.prox.enterHint')}`}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onLater} className="btn btn-quiet">{t('discovery.prox.notNow')}</button>
        <button type="button" onClick={onEnter} className="btn btn-primary">{multi ? t('discovery.prox.choose') : t('discovery.prox.enter')}</button>
      </div>
    </motion.div>
  );
}

/** More than one shop is in range: let the buyer pick which one to walk into. */
function ShopPicker({
  shops,
  dists,
  onPick,
  onClose,
}: {
  shops: Array<{ id: string; name: { en: string }; emoji: string }>;
  dists: Record<string, number>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <motion.div
      {...promptMotion}
      role="alertdialog"
      aria-labelledby="pick-title"
      className="surface-solid fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-50 mx-auto grid max-w-md gap-3 p-4 sm:bottom-24"
    >
      <div className="flex items-center justify-between">
        <p id="pick-title" className="text-lg font-bold text-ink">{t('discovery.picker.title')}</p>
        <button type="button" onClick={onClose} className="btn btn-link !min-h-9 !px-2 !text-sm">{t('discovery.prox.notNow')}</button>
      </div>
      <div className="grid gap-2">
        {shops.map((s, i) => (
          <motion.button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="surface flex min-h-16 items-center gap-3 p-3 text-left transition active:scale-[0.99]"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-paper-3 text-2xl" aria-hidden="true">{s.emoji}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink">{s.name.en}</span>
              <span className="block text-xs text-ink-muted">{Math.round(dists[s.id] ?? 0)} {t('discovery.meterAway')}</span>
            </span>
            <span className="text-chili" aria-hidden="true">→</span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}
