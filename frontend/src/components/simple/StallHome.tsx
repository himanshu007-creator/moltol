import { useSimple } from '@/stores/simple';
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
  const dict = s(language);

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
        onClick={() => toggle(DEMO_SLOT_ID)}
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
