import { motion } from 'motion/react';
import { lastOffer } from '@/lib/negotiation';
import type { selectBazaar } from '@/stores/bazaar';
import { formatMoney } from '@/lib/money';

type Sum = ReturnType<typeof selectBazaar>;
type Lane = Sum['lanes'][number];

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** where the buyer/shop offers currently sit, as % of basis — shared by Row and MosaicTile */
function gap(l: Lane) {
  const settled = l.done && !l.noDeal;
  const basis = l.listCents * 1.15;
  const buyerCents = lastOffer(l.state, 'buyer');
  const shopCents = lastOffer(l.state, 'shop');
  const buyerPct = settled
    ? clamp(((l.agreedCents ?? l.listCents) / basis) * 100, 0, 100)
    : buyerCents == null
      ? 0
      : clamp((buyerCents / basis) * 100, 0, 100);
  const shopPct = settled ? buyerPct : shopCents == null ? 100 : clamp((shopCents / basis) * 100, 0, 100);
  return { settled, buyerCents, shopCents, buyerPct, shopPct, lo: Math.min(buyerPct, shopPct), hi: Math.max(buyerPct, shopPct) };
}

/** marigold, teal, indigo, chili — cycles if there are more lanes than colours */
const ORB_PALETTE = ['var(--glow-marigold)', 'var(--glow-teal)', 'var(--glow-indigo)', 'var(--glow-chili)'];

/**
 * Every item's live haggle, at a glance: a lantern per item, lighting up as
 * the buyer's and shop's offers converge — not a shared-axis chart, so it
 * never turns into spaghetti, and not rows of numbers, so brightness alone
 * tells the story whether there's 1 item or 100.
 */
export function OverviewTugOfWar({ sum }: { sum: Sum }) {
  const agreedCount = sum.lanes.filter((l) => l.done && !l.noDeal).length;
  return (
    <div className="glow-stage relative flex h-full min-h-0 flex-col gap-3 overflow-hidden rounded-2xl p-3">
      <div className="glow-dust" />
      <div className="relative shrink-0 space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-bold" style={{ color: 'var(--glow-ink)' }}>
            {agreedCount} of {sum.totalDone} agreed
          </span>
          {agreedCount > 0 && (
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
              style={{ background: 'color-mix(in oklab, var(--glow-teal) 20%, transparent)', color: 'var(--glow-teal)' }}
            >
              saved {formatMoney(sum.totalSavedCents)}
            </span>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'color-mix(in oklab, var(--glow-ink) 12%, transparent)' }}>
          <motion.div
            className="glow-line-marigold h-full"
            style={{ background: 'var(--glow-marigold)' }}
            initial={false}
            animate={{ width: `${sum.readiness}%` }}
            transition={{ type: 'spring', stiffness: 220, damping: 24 }}
          />
        </div>
        {sum.noDealCount > 0 && (
          <p className="text-[11px]" style={{ color: 'var(--glow-ink-faint)' }}>{sum.noDealCount} no-deal</p>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))' }}>
          {sum.lanes.map((l, i) => (
            <LanternOrb key={l.sku} l={l} color={ORB_PALETTE[i % ORB_PALETTE.length]!} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * One item, one lantern: dim and small while the buyer and shop are still
 * far apart, brightening smoothly as their offers converge, fully lit and
 * breathing once they settle — brightness as progress, no legend needed.
 * CSS-transition driven (no per-orb spring), so it stays smooth at 100+.
 */
export function LanternOrb({ l, color }: { l: Lane; color: string }) {
  const { settled, buyerCents, shopCents, lo, hi } = gap(l);
  const closeness = clamp(1 - (hi - lo) / 100, 0, 1);
  const glowColor = l.noDeal ? 'var(--glow-ink-faint)' : settled ? 'var(--glow-teal)' : color;
  const blur = 3 + closeness * 16;
  const spread = 1 + closeness * 4;
  const core = 0.5 + closeness * 0.5;

  const label = settled
    ? `${l.title.en} × ${l.qty} — agreed ${formatMoney(l.agreedCents ?? 0)}`
    : l.noDeal
      ? `${l.title.en} × ${l.qty} — no deal`
      : `${l.title.en} × ${l.qty} — haggling, you ${buyerCents != null ? formatMoney(buyerCents) : '—'}, shop ${shopCents != null ? formatMoney(shopCents) : '—'}`;

  return (
    <div title={label} aria-label={label} className="relative grid aspect-square place-items-center">
      <div
        className={settled ? 'glow-pulse rounded-full' : 'rounded-full transition-[box-shadow,opacity] duration-500 ease-out'}
        style={{
          width: '62%',
          height: '62%',
          background: `radial-gradient(circle at 35% 30%, color-mix(in oklab, ${glowColor} 90%, white 10%), ${glowColor})`,
          boxShadow: settled ? undefined : `0 0 ${blur}px ${spread}px color-mix(in oklab, ${glowColor} ${Math.round(core * 100)}%, transparent)`,
          opacity: l.noDeal ? 0.35 : 1,
          color: glowColor,
        }}
      />
      <span className="pointer-events-none absolute text-base leading-none" aria-hidden="true">
        {l.emoji}
      </span>
    </div>
  );
}

