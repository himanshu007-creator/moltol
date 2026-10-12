import { useEffect, useMemo, useState } from 'react';
import { navigate } from 'astro:transitions/client';
import { useVenue, splitNearby } from '@/stores/venue';
import { useLiveShops } from '@/stores/inventory';
import { useYou, distancesFrom, ENTER_RADIUS_M } from '@/stores/you';
import { haversineM, BAZAAR_CENTER, type GeoPoint } from '@/lib/mock/discovery';
import LeafletMap from '@/components/discovery/LeafletMap';

/** GPS waits this long for a first fix, then falls back to "off". */
const GPS_TIMEOUT_MS = 8000;
/** Beyond this, a real GPS fix is from a tester nowhere near the demo bazaar
 *  (the common case) — show it honestly instead of pretending you're local. */
const GPS_TOO_FAR_M = 1500;

/**
 * Nearby discovery. One position store drives the map, the distance order and the
 * proximity prompt. Position is real GPS when the browser gives it (shown with its
 * true distance, however far that is), otherwise the bazaar centre — plus a demo
 * helper to teleport next to the real shops and try the proximity flow.
 */
export default function ShopDiscovery() {
  const stalls = useVenue((s) => s.stalls);
  const shops = useLiveShops();
  const point = useYou((s) => s.point);
  const source = useYou((s) => s.source);
  const setGps = useYou((s) => s.setGps);
  const placeNearShop = useYou((s) => s.placeNearShop);

  const [gps, setGpsState] = useState<'locating' | 'ok' | 'denied' | 'far'>('locating');
  const [watchKey, setWatchKey] = useState(0);
  // "Not now" silences the prompt until the buyer has moved at least 50 m from where they dismissed it
  const [dismissedAt, setDismissedAt] = useState<GeoPoint | null>(null);
  const [picking, setPicking] = useState(false);
  const quiet = dismissedAt !== null && haversineM(point, dismissedAt) < 50;

  // live GPS when the browser allows it; a timeout ends "locating" either way
  useEffect(() => {
    setGpsState('locating');
    if (!('geolocation' in navigator)) {
      setGpsState('denied');
      return;
    }
    const timer = setTimeout(() => setGpsState((s) => (s === 'locating' ? 'denied' : s)), GPS_TIMEOUT_MS);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        clearTimeout(timer);
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (haversineM(fix, BAZAAR_CENTER) > GPS_TOO_FAR_M) {
          setGpsState('far');
          return;
        }
        setGps(fix);
        setGpsState('ok');
      },
      () => {
        clearTimeout(timer);
        setGpsState('denied');
      },
      { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 15_000 },
    );
    return () => {
      clearTimeout(timer);
      navigator.geolocation.clearWatch(id);
    };
  }, [watchKey, setGps]);

  const dists = useMemo(() => distancesFrom(point), [point]);
  const { open: sorted, closed } = useMemo(() => splitNearby(shops, stalls, dists), [shops, stalls, dists]);

  // every open shop you're standing next to, nearest first — not just one
  const nearbyList = useMemo(
    () => (source === 'default' || quiet ? [] : sorted.filter((s) => (dists[s.id] ?? Infinity) <= ENTER_RADIUS_M)),
    [source, quiet, sorted, dists],
  );

  const pins = [
    ...sorted.map((s) => ({ id: s.id, name: s.name.en, emoji: s.emoji, lat: s.lat, lng: s.lng, open: true, meters: dists[s.id] ?? 0 })),
    ...closed.map((s) => ({ id: s.id, name: s.name.en, emoji: s.emoji, lat: s.lat, lng: s.lng, open: false, meters: dists[s.id] ?? 0 })),
  ];

  const statusLine =
    source === 'gps'
      ? '📍 Live GPS · exact distance'
      : source === 'placed'
        ? '📍 Placed near a shop (demo)'
        : gps === 'locating'
          ? 'Finding you…'
          : gps === 'far'
            ? "You're far from the demo bazaar — GPS shows your real distance."
            : 'GPS is off.';

  const enterShop = (id: string) => {
    setPicking(false);
    void navigate(`/app/stall?id=${id}`);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <section className="surface grid gap-3 p-3 sm:p-4 lg:sticky lg:top-24" aria-label="Map">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
          <span aria-live="polite">{statusLine}</span>
          <span className="pill">source: {source}</span>
        </div>

        <LeafletMap point={point} pins={pins} />

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={placeNearShop} className="btn btn-quiet !min-h-11 !px-4 !text-sm">
            📍 Place me near a shop
          </button>
          {(gps === 'denied' || gps === 'far') && (
            <button type="button" onClick={() => setWatchKey((k) => k + 1)} className="btn btn-quiet !min-h-11 !px-4 !text-sm">
              📍 Try GPS again
            </button>
          )}
        </div>
      </section>

      <div className="grid gap-4">
        {sorted.length === 0 ? (
          <p className="surface p-6 text-center text-ink-muted">🛌 No stalls are open right now. Check back soon.</p>
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
                  <span className="pill pill-teal">Open</span>
                  <span className="text-chili" aria-hidden="true">→</span>
                </a>
              </li>
            ))}
          </ul>
        )}

        {closed.length > 0 && (
          <section aria-labelledby="closed-heading" className="grid gap-3">
            <h2 id="closed-heading" className="t-label">Closed now</h2>
            <ul className="grid gap-3" data-testid="closed-stalls">
              {closed.map((s) => (
                <li key={s.id}>
                  <a href={`/app/stall?id=${s.id}`} className="surface-soft flex min-h-20 items-center gap-4 p-4 opacity-80">
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-paper-3 text-3xl grayscale" aria-hidden="true">{s.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="t-h2 block !text-[1.15rem]">{s.name.en}</span>
                      <span className="block text-sm text-ink-muted">{s.persona}</span>
                    </span>
                    <span className="pill pill-chili">Closed</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {nearbyList.length === 1 && (
        <ProximityPrompt
          name={nearbyList[0].name.en}
          emoji={nearbyList[0].emoji}
          meters={dists[nearbyList[0].id] ?? 0}
          onEnter={() => enterShop(nearbyList[0].id)}
          onLater={() => setDismissedAt(point)}
        />
      )}

      {nearbyList.length > 1 && !picking && (
        <ProximityPrompt
          name={`${nearbyList.length} shops`}
          emoji="🧭"
          meters={dists[nearbyList[0].id] ?? 0}
          multi
          onEnter={() => setPicking(true)}
          onLater={() => setDismissedAt(point)}
        />
      )}

      {nearbyList.length > 1 && picking && (
        <ShopPicker shops={nearbyList} dists={dists} onPick={enterShop} onClose={() => setPicking(false)} />
      )}
    </div>
  );
}

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
  return (
    <div
      role="alertdialog"
      aria-labelledby="prox-title"
      aria-describedby="prox-body"
      className="surface-solid fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-50 mx-auto grid max-w-md gap-3 p-4 sm:bottom-24"
    >
      <div className="flex items-center gap-3">
        <span className="text-3xl" aria-hidden="true">{emoji}</span>
        <div className="min-w-0">
          <p id="prox-title" className="text-lg font-bold text-ink">{multi ? `You're near ${name}` : `You're at ${name}`}</p>
          <p id="prox-body" className="text-sm text-ink-muted">
            {multi ? 'Pick which one you want to visit.' : `${Math.round(meters)} m away. Enter the stall to see prices and haggle.`}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onLater} className="btn btn-quiet">Not now</button>
        <button type="button" onClick={onEnter} className="btn btn-primary">{multi ? 'Choose a shop' : 'Enter stall'}</button>
      </div>
    </div>
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
  return (
    <div
      role="alertdialog"
      aria-labelledby="pick-title"
      className="surface-solid fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-50 mx-auto grid max-w-md gap-3 p-4 sm:bottom-24"
    >
      <div className="flex items-center justify-between">
        <p id="pick-title" className="text-lg font-bold text-ink">Which shop?</p>
        <button type="button" onClick={onClose} className="btn btn-link !min-h-9 !px-2 !text-sm">Not now</button>
      </div>
      <div className="grid gap-2">
        {shops.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            className="surface flex min-h-16 items-center gap-3 p-3 text-left transition active:scale-[0.99]"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-paper-3 text-2xl" aria-hidden="true">{s.emoji}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink">{s.name.en}</span>
              <span className="block text-xs text-ink-muted">{Math.round(dists[s.id] ?? 0)} m away</span>
            </span>
            <span className="text-chili" aria-hidden="true">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
