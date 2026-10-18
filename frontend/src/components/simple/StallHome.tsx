import { useState } from 'react';
import { useSimple } from '@/stores/simple';
import { useSession } from '@/stores/session';
import { setShopStatus, updateShopLocation } from '@/lib/backend';
import { s, nativeRupaye } from '@/lib/simple/strings';
import { useVenue, DEMO_SLOT_ID } from '@/stores/venue';
import { cn } from '@/lib/cn';

/**
 * Simple Mode home for a shopkeeper: the stall, one big open/closed switch, and
 * four large tiles. Every tile is one task; the offer banner jumps straight to it.
 */
export default function StallHome() {
  const { stallName, stallEmoji, haggle, todayEarningsCents, language } = useSimple();
  const open = useVenue((s) => s.stalls[DEMO_SLOT_ID]?.open !== false);
  const toggle = useVenue((s) => s.toggle);
  const token = useSession((st) => st.token);
  const dict = s(language);
  const [locating, setLocating] = useState<'idle' | 'working' | 'done' | 'error'>('idle');

  const toggleStall = () => {
    toggle(DEMO_SLOT_ID);
    // Additive: a seller with a real backend shop also flips it for real, so
    // buyers' `/v1/shops/nearby` and the live status stream agree with what
    // the seller sees here.
    if (token) void setShopStatus(token, { open: !open }).catch(() => {});
  };

  // A one-time pin, not live tracking (see BE_MISSING_THINGS.md's "Live vendor
  // location" — continuous movement is a separate, not-yet-built feature and
  // a real privacy decision). Without this, a real shop never has a location
  // and so never appears on a buyer's `/v1/shops/nearby`.
  const setMyLocation = () => {
    if (!token || !('geolocation' in navigator)) return;
    setLocating('working');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void updateShopLocation(token, { lat: pos.coords.latitude, lng: pos.coords.longitude })
          .then(() => setLocating('done'))
          .catch(() => setLocating('error'));
      },
      () => setLocating('error'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const tiles = [
    { icon: '📷', label: dict.u.scanTitle, sub: dict.u.scanHint, to: '/app/seller/simple/scan', tone: 'bg-indigo/15' },
    { icon: '💰', label: dict.u.homeToday, sub: nativeRupaye(todayEarningsCents, language), to: '/app/seller/simple/price', tone: 'bg-marigold/30', live: true },
    { icon: '🤝', label: dict.u.homeDeals, sub: haggle.step === 'offer' ? dict.u.homeNew : dict.u.haggleWaiting, to: '/app/seller/simple/haggle', tone: 'bg-chili/15', hot: haggle.step !== 'idle' },
    { icon: '📈', label: dict.u.homeEarnings, sub: dict.u.earningsToday, to: '/app/seller/simple/earnings', tone: 'bg-teal/15' },
  ];

  return (
    <div className="mx-auto grid w-full max-w-md gap-6 px-5 pb-32 pt-6 sm:max-w-2xl">

      <section className="surface-accent flex items-center gap-4 p-5">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-paper/80 text-4xl shadow-sm" aria-hidden="true">{stallEmoji}</span>
        <div className="min-w-0">
          <p className="t-label !text-[#5b3200]">Your stall</p>
          <h1 className="t-h1 truncate !text-[#23180a]">{stallName}</h1>
        </div>
      </section>

      {/* the big switch: open or closed, one tap */}
      <button
        type="button"
        role="switch"
        aria-checked={open}
        aria-label={open ? dict.u.stallCloseCta : dict.u.stallOpenCta}
        onClick={toggleStall}
        className={cn(
          'surface flex min-h-24 w-full items-center gap-4 p-5 text-left transition active:scale-[0.99]',
          open ? 'border-teal/50 bg-teal/10' : 'border-chili/50 bg-chili/10',
        )}
      >
        <span className={cn('relative h-10 w-16 shrink-0 rounded-full transition', open ? 'bg-teal' : 'bg-ink-faint')} aria-hidden="true">
          <span className={cn('absolute top-1 h-8 w-8 rounded-full bg-paper shadow transition-all', open ? 'left-[1.9rem]' : 'left-1')} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block text-xl font-bold', open ? 'text-teal' : 'text-chili')}>
            {open ? dict.u.stallOpen : dict.u.stallClosed}
          </span>
          <span className="block text-sm text-ink-muted">{open ? dict.u.stallOpenHint : dict.u.stallClosedHint}</span>
        </span>
      </button>

      {token && (
        <button
          type="button"
          onClick={setMyLocation}
          disabled={locating === 'working'}
          className="surface flex min-h-11 items-center justify-center gap-2 px-4 text-sm font-semibold text-ink-muted transition active:scale-[0.99] disabled:opacity-60"
        >
          <span aria-hidden="true">📍</span>
          {locating === 'done'
            ? 'Location set — buyers nearby can find you'
            : locating === 'working'
              ? 'Finding you…'
              : locating === 'error'
                ? "Couldn't get your location — try again"
                : 'Set my location on the map'}
        </button>
      )}

      {haggle.step === 'offer' && (
        <a href="/app/seller/simple/haggle" className="surface-solid flex items-center justify-between gap-4 p-5 active:scale-[0.99]">
          <span className="min-w-0">
            <span className="t-label !text-indigo">{dict.u.homeNew}</span>
            <span className="mt-2 block">
              <span className="price-tag !text-2xl">{haggle.offerCents != null ? nativeRupaye(haggle.offerCents, language) : ''}</span>
            </span>
          </span>
          <span className="btn btn-primary !min-h-14 !text-lg">Open</span>
        </a>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {tiles.map((t) => (
          <a
            key={t.to}
            href={t.to}
            className={cn('surface relative flex min-h-44 flex-col justify-between gap-4 p-5 transition active:scale-[0.98]', t.hot && 'ring-2 ring-chili')}
          >
            <span className={cn('grid h-14 w-14 place-items-center rounded-2xl text-3xl', t.tone)} aria-hidden="true">{t.icon}</span>
            <span className="grid gap-1">
              <span className="text-sm font-semibold text-ink-muted">{t.label}</span>
              <span className="text-xl font-bold leading-tight text-ink" aria-live="polite">{t.sub}</span>
            </span>
            {t.live && <span className="pill pill-marigold absolute right-3 top-3">Live</span>}
            {t.hot && <span className="pill pill-chili absolute right-3 top-3">New</span>}
          </a>
        ))}
      </div>
    </div>
  );
}
