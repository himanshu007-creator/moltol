import { useEffect, useState } from 'react';
import { useVenue } from '@/stores/venue';
import { useSession } from '@/stores/session';
import { cn } from '@/lib/cn';

/**
 * Open/close switch for the seller's own stall, plus optional timers:
 * "close in 15 min" while open, "reopen in 30 min" while closed.
 * The same store drives the buyer map, so flips show up there straight away
 * (and in other tabs via BroadcastChannel).
 */
export default function VendorStatusToggle({ stallId, compact = false }: { stallId?: string; compact?: boolean }) {
  const ownShopId = useSession((s) => s.shopId);
  const id = stallId ?? ownShopId;
  const st = useVenue((s) => (id ? s.stalls[id] : undefined));
  const open = st?.open !== false;
  const toggle = useVenue((s) => s.toggle);
  const closeIn = useVenue((s) => s.closeIn);
  const reopenIn = useVenue((s) => s.reopenIn);
  const setOpen = useVenue((s) => s.setOpen);
  const pending = open ? st?.closeAt : st?.reopenAt;

  // countdown refresh; only while a timer is pending
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setNow((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, [pending]);

  const mins = pending ? Math.max(1, Math.ceil((pending - Date.now()) / 60_000)) : 0;

  if (!id) return null; // no real shop yet — nothing to toggle

  if (compact) {
    // header pill: one line, thumb-sized, same store
    return (
      <button
        type="button"
        role="switch"
        aria-checked={open}
        aria-label={open ? 'Your stall is open. Tap to close it for buyers.' : 'Your stall is closed. Tap to open it for buyers.'}
        onClick={() => toggle(id)}
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl px-3 text-sm font-semibold',
          open ? 'bg-teal/15 text-teal' : 'bg-chili/15 text-chili',
        )}
      >
        <span>{open ? '🟢 Stall open' : '🔴 Stall closed'}</span>
        <span className={cn('relative h-6 w-10 shrink-0 rounded-full', open ? 'bg-teal' : 'bg-ink-faint')} aria-hidden="true">
          <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-paper transition-all', open ? 'left-[1.1rem]' : 'left-0.5')} />
        </span>
      </button>
    );
  }

  return (
    <div className={cn('grid gap-2', compact && 'gap-1')}>
      <button
        type="button"
        role="switch"
        aria-checked={open}
        aria-label={open ? 'Your stall is open. Tap to close it for buyers.' : 'Your stall is closed. Tap to open it for buyers.'}
        onClick={() => toggle(id)}
        className={cn(
          'flex w-full min-h-14 items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.99]',
          open ? 'border-teal/40 bg-teal/10' : 'border-chili/40 bg-chili/10',
        )}
      >
        <span className={cn('relative h-7 w-12 shrink-0 rounded-full', open ? 'bg-teal' : 'bg-ink-faint')} aria-hidden="true">
          <span className={cn('absolute top-0.5 h-6 w-6 rounded-full bg-paper transition-all', open ? 'left-[1.6rem]' : 'left-0.5')} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block font-semibold', open ? 'text-teal' : 'text-chili')}>
            {open ? '🟢 Open: buyers can find you' : '🔴 Closed: shown as closed to buyers'}
          </span>
          <span className="block text-xs text-ink-faint">
            {pending
              ? open
                ? `Closing in ${mins} min`
                : `Reopening in ${mins} min`
              : open
                ? 'Tap to close.'
                : 'Tap to reopen.'}
          </span>
        </span>
      </button>

      {!compact && (
        <div className="flex flex-wrap gap-2">
          {open
            ? [15, 60].map((m) => (
                <button key={m} type="button" onClick={() => closeIn(id, m)} className="min-h-11 rounded-full bg-paper-3 px-4 text-sm font-medium text-ink">
                  Close in {m} min
                </button>
              ))
            : [30, 120].map((m) => (
                <button key={m} type="button" onClick={() => reopenIn(id, m)} className="min-h-11 rounded-full bg-paper-3 px-4 text-sm font-medium text-ink">
                  Reopen in {m} min
                </button>
              ))}
          {pending && (
            <button type="button" onClick={() => setOpen(id, open)} className="min-h-11 rounded-full px-4 text-sm font-medium text-indigo underline">
              Cancel timer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
