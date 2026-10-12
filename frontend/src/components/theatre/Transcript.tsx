import { useEffect, useRef } from 'react';
import type { TurnEntry } from '@/lib/negotiation';
import { cn } from '@/lib/cn';
import { sideAccent } from '@/lib/ui';
import { formatMoney } from '@/lib/money';
import { TacticChip } from '@/components/react/ui';

/** The live transcript. Text is the point — legible, coloured, announced. */
export function Transcript({ turns, currency }: { turns: TurnEntry[]; currency: string }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns.length]);

  if (turns.length === 0) {
    return (
      <p className="px-1 py-6 text-sm text-ink-faint">
        The agents are still reading the room…
      </p>
    );
  }

  return (
    <ol className="flex max-h-80 flex-col gap-2.5 overflow-y-auto pr-1" aria-live="polite" aria-relevant="additions">
      {turns.map((turn) => {
        const a = sideAccent(turn.actor);
        const accepted = turn.kind === 'accept';
        const walked = turn.kind === 'walkaway';
        return (
          <li key={turn.seq} className="flex gap-2.5">
            <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', a.dot)} aria-hidden="true" />
            <div
              className={cn(
                'min-w-0 flex-1 rounded-2xl border px-3 py-2',
                accepted
                  ? 'border-teal/45 bg-teal/10'
                  : walked
                    ? 'border-chili/40 bg-chili/5'
                    : 'border-chalk bg-paper',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('text-xs font-semibold uppercase tracking-wide', a.text)}>{a.label}</span>
                <span className="text-[11px] text-ink-faint">
                  {turn.kind}
                  {turn.priceCents != null && (
                    <span className="ml-1 font-mono tabular-nums text-ink-muted">
                      {formatMoney(turn.priceCents, currency)}
                    </span>
                  )}
                </span>
                {turn.tactic && <TacticChip tactic={turn.tactic} />}
              </div>
              <p className="mt-1 text-sm text-ink">{turn.message}</p>
            </div>
          </li>
        );
      })}
      <div ref={endRef} />
    </ol>
  );
}
