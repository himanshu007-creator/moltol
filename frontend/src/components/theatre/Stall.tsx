import { cn } from '@/lib/cn';
import { card, sideAccent } from '@/lib/ui';
import { Price, SideTag } from '@/components/react/ui';
import type { Side } from '@/lib/events';

/** One side of the bazaar: an agent orb, its persona, and its latest offer. */
export function Stall({
  side,
  name,
  persona,
  lastCents,
  currency,
  thinking,
  human = false,
}: {
  side: Side;
  name: string;
  persona: string;
  lastCents: number | null;
  currency: string;
  thinking?: boolean;
  human?: boolean;
}) {
  const a = sideAccent(side);
  const orb =
    side === 'buyer'
      ? 'bg-[radial-gradient(circle_at_35%_30%,#ffd977,var(--color-marigold)_55%,#b8791a)]'
      : 'bg-[radial-gradient(circle_at_35%_30%,#ff9aa8,var(--color-chili)_55%,#9c1526)]';
  return (
    <div className={cn(card, 'flex items-center gap-3 p-3.5 sm:flex-col sm:p-4 sm:text-center')}>
      <div className="relative shrink-0">
        <div
          className={cn(
            'grid h-12 w-12 place-items-center rounded-full sm:h-14 sm:w-14',
            orb,
            thinking && 'animate-pulse-soft',
          )}
        >
          <span className="h-4 w-4 rounded-full bg-paper/85 mix-blend-screen sm:h-5 sm:w-5" />
        </div>
        {thinking && (
          <span className={cn('absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-paper-2', a.dot)} />
        )}
      </div>

      <div className="min-w-0 sm:mt-1">
        <div className="flex items-center gap-2 sm:justify-center">
          <SideTag side={side} />
          {human && (
            <span className="rounded-full bg-ink/85 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-paper">
              you
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm font-semibold text-ink">{name}</p>
        <p className="line-clamp-2 text-xs text-ink-faint">{persona}</p>
        <div className="mt-1.5 sm:mt-2">
          <span className="text-[11px] text-ink-faint">holding at </span>
          <Price cents={lastCents} currency={currency} className="text-base font-semibold text-ink" />
        </div>
      </div>
    </div>
  );
}
