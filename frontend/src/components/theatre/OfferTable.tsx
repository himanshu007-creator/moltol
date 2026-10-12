import { motion } from 'motion/react';
import type { Market } from '@/lib/events';
import { cn } from '@/lib/cn';
import { Price } from '@/components/react/ui';
import { sideAccent } from '@/lib/ui';

function OfferToken({
  side,
  cents,
  currency,
}: {
  side: 'buyer' | 'shop';
  cents: number;
  currency: string;
}) {
  const a = sideAccent(side);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={cn(
          'relative rounded-[var(--radius-tag)] border-2 bg-paper-2 px-4 py-2.5 shadow-[0_14px_30px_-18px_rgba(27,31,59,0.6)]',
          a.border,
        )}
      >
        <span
          className={cn('absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 bg-paper', a.border)}
          aria-hidden="true"
        />
        <Price cents={cents} currency={currency} className={cn('text-xl font-bold', a.text)} />
      </div>
      <span className={cn('text-[10px] font-semibold uppercase tracking-widest', a.text)}>{a.label}</span>
    </div>
  );
}

const spring = { type: 'spring', stiffness: 160, damping: 22, mass: 0.8 } as const;

/** Offers travel as physical tags across the table (FE_plan §6). */
export function OfferTable({
  buyerCents,
  shopCents,
  market,
  currency,
  round,
  roundsMax,
}: {
  buyerCents: number | null;
  shopCents: number | null;
  market: Market | null;
  currency: string;
  round: number;
  roundsMax: number;
}) {
  const lo = market?.p25Cents ?? 0;
  const hi = market?.p75Cents ?? (Math.max(buyerCents ?? 0, shopCents ?? 1) || 1);
  const norm = (v: number) => Math.max(0, Math.min(1, (v - lo) / Math.max(1, hi - lo)));

  const buyerLeft = 2 + (buyerCents != null ? norm(buyerCents) : 0) * 78;
  const shopRight = 2 + (shopCents != null ? 1 - norm(shopCents) : 0) * 78;
  const gap = buyerCents != null && shopCents != null ? shopCents - buyerCents : null;

  return (
    <div className="relative h-44 select-none sm:h-48" aria-hidden="true">
      <div className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-chalk" />
      <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-chalk-strong bg-paper" />

      {buyerCents != null && (
        <motion.div
          className="absolute top-1/2 -translate-y-1/2"
          initial={false}
          animate={{ left: `${buyerLeft}%` }}
          transition={spring}
        >
          <OfferToken side="buyer" cents={buyerCents} currency={currency} />
        </motion.div>
      )}

      {shopCents != null && (
        <motion.div
          className="absolute top-1/2 -translate-y-1/2"
          initial={false}
          animate={{ right: `${shopRight}%` }}
          transition={spring}
        >
          <OfferToken side="shop" cents={shopCents} currency={currency} />
        </motion.div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 text-xs text-ink-faint">
        <span className="font-mono tabular-nums">
          round {Math.min(round, roundsMax)} / {roundsMax}
        </span>
        {gap != null && gap > 0 && (
          <span className="font-mono tabular-nums">spread {Math.round(gap / 100)}</span>
        )}
      </div>
    </div>
  );
}
