import { navigate } from 'astro:transitions/client';
import { useSession } from '@/stores/session';
import { ROUTES, type SellerMode } from '@/lib/routes';
import { cn } from '@/lib/cn';
import { useI18n } from '@/stores/prefs';

/**
 * Asked once when a seller picks a dashboard, and changeable later from the account menu.
 * Simple = big buttons and voice help. Modern = stock, ledger and shop.
 */
export default function SellerModeChooser({ next }: { next?: string }) {
  const setSellerMode = useSession((s) => s.setSellerMode);
  const current = useSession((s) => s.sellerMode);
  const { t } = useI18n();

  const pick = (mode: SellerMode) => {
    setSellerMode(mode);
    const dest = next ?? (mode === 'modern' ? ROUTES.seller.home : ROUTES.simple.home);
    void navigate(dest);
  };

  const cards: Array<{ mode: SellerMode; title: string; blurb: string; icon: string; tone: string }> = [
    { mode: 'simple', title: t('chooser.simple'), blurb: t('chooser.simpleBlurb'), icon: '🪔', tone: 'bg-marigold' },
    { mode: 'modern', title: t('chooser.modern'), blurb: t('chooser.modernBlurb'), icon: '📊', tone: 'bg-indigo text-paper' },
  ];

  return (
    <div className="grid gap-4" role="radiogroup" aria-label="How do you want to run your stall?">
      {cards.map((c) => (
        <button
          key={c.mode}
          type="button"
          role="radio"
          aria-checked={current === c.mode}
          onClick={() => pick(c.mode)}
          className={cn('surface flex min-h-28 items-center gap-5 p-6 text-left transition active:scale-[0.99]', current === c.mode && 'ring-2 ring-ink')}
        >
          <span className={cn('grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-3xl', c.tone)} aria-hidden="true">{c.icon}</span>
          <span className="min-w-0">
            <span className="block text-2xl font-bold text-ink">{c.title}</span>
            <span className="block text-base text-ink-muted">{c.blurb}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
