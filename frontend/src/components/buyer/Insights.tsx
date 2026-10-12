import { useMemo } from 'react';
import { BUYER_HISTORY } from '@/lib/mock/seeds';
import { samples } from '@/lib/mock/market';
import { useOrders } from '@/stores/orders';
import { formatMoney, formatMoneyWhole } from '@/lib/money';
import PeriodChart from '@/components/vendor/PeriodChart';
import HaggleStyleCard from '@/components/buyer/HaggleStyleCard';

/** Monthly budget goal, paise. Mock: ₹15,000. */
export const MONTHLY_GOAL_CENTS = 1_500_000;

/** Buyer insights: each card is a headline, a reason, and one tap. */
export default function Insights() {
  const orders = useOrders((s) => s.orders);
  // the demo history (3 months) counts toward the totals, so a fresh install shows real numbers
  const histSaved = BUYER_HISTORY.reduce((s, m) => s + m.savedCents, 0);
  const histSpend = BUYER_HISTORY.reduce((s, m) => s + m.spendCents, 0);
  const histBaskets = BUYER_HISTORY.reduce((s, m) => s + m.baskets, 0);
  const totalSaved = useMemo(() => histSaved + orders.reduce((s, o) => s + o.savingsCents, 0), [orders, histSaved]);
  const totalSpend = useMemo(() => histSpend + orders.reduce((s, o) => s + o.totalCents, 0), [orders, histSpend]);
  const baskets = histBaskets + orders.length;
  const avgSavedPct = totalSpend + totalSaved > 0 ? Math.round((totalSaved / (totalSpend + totalSaved)) * 100) : 0;

  // the demo history covers months before today; the last month is "this month" in the chart
  const thisMonth = BUYER_HISTORY[BUYER_HISTORY.length - 1]!;
  const spentThisMonth = thisMonth.spendCents;
  const budgetPct = Math.min(100, Math.round((spentThisMonth / MONTHLY_GOAL_CENTS) * 100));
  const chart = BUYER_HISTORY.map((m) => ({ label: m.label, revenueCents: m.spendCents, profitCents: m.savedCents }));

  const nudge = useMemo(() => priceNudge('tomato'), []);

  return (
    <div className="grid gap-6 pb-32">
      <header>
        <h1 className="t-h1">Your wins</h1>
        <p className="text-sm text-ink-faint">Estimates from the demo history until the backend is wired.</p>
      </header>

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3">
        <Card icon="💸" value={formatMoneyWhole(totalSaved)} label="Saved, all baskets" tint="text-teal" />
        <Card icon="🧺" value={String(baskets)} label="Baskets haggled" tint="text-ink" />
        <Card icon="📉" value={`${avgSavedPct}%`} label="Average saved vs sticker" tint="text-warn" />
        <Card icon="🔥" value={String(streakDays(orders.map((o) => o.ts)))} label="Day streak" tint="text-chili" />
      </section>

      <section aria-labelledby="budget-h" className="grid gap-3 surface p-4">
        <div className="flex items-baseline justify-between">
          <h2 id="budget-h" className="text-sm font-semibold text-ink">This month's budget</h2>
          <span className="text-xs text-ink-faint">{formatMoneyWhole(spentThisMonth)} of {formatMoneyWhole(MONTHLY_GOAL_CENTS)}</span>
        </div>
        <div role="progressbar" aria-valuenow={budgetPct} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used" className="h-3 overflow-hidden rounded-full bg-paper-3">
          <div className="h-full rounded-full bg-marigold" style={{ width: `${budgetPct}%` }} />
        </div>
        <p className="text-xs text-ink-faint">
          {budgetPct >= 100 ? 'Over the goal this month.' : `${100 - budgetPct}% left. Spending is on track.`}
        </p>
      </section>

      <section aria-labelledby="trend-h" className="grid gap-3 surface p-4">
        <h2 id="trend-h" className="text-sm font-semibold text-ink">Spend and saved · last 6 months</h2>
        <PeriodChart data={chart} label="Monthly spend and savings" legend={['Spend', 'Saved']} />
        <p className="text-xs text-ink-faint">Spend is {monthOverMonth() >= 0 ? 'up' : 'down'} {Math.abs(monthOverMonth())}% against last month.</p>
      </section>

      {nudge && (
        <section aria-labelledby="nudge-h" className="grid gap-2 rounded-3xl border border-teal/40 bg-teal/10 p-4">
          <h2 id="nudge-h" className="text-sm font-semibold text-ink">Nudge</h2>
          <p className="text-base font-semibold text-ink">{nudge.headline}</p>
          <p className="text-sm text-ink-faint">{nudge.reason}</p>
          <a href={`/app/stall?id=${nudge.shopId}`} className="min-h-11 w-fit rounded-2xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper">
            Open that stall
          </a>
        </section>
      )}

      <HaggleStyleCard />
    </div>
  );
}

function Card({ icon, value, label, tint }: { icon: string; value: string; label: string; tint: string }) {
  return (
    <div className="surface p-4">
      <span className="text-2xl" aria-hidden="true">{icon}</span>
      <p className={`mt-1 font-mono text-xl font-black tabular-nums ${tint}`}>{value}</p>
      <p className="text-[11px] text-ink-faint">{label}</p>
    </div>
  );
}

function monthOverMonth(): number {
  const a = BUYER_HISTORY[BUYER_HISTORY.length - 2]!.spendCents;
  const b = BUYER_HISTORY[BUYER_HISTORY.length - 1]!.spendCents;
  return Math.round(((b - a) / a) * 100);
}

/** Cheapest market price for an item, if it is a different, nearby-cheaper stall. */
function priceNudge(itemId: 'tomato') {
  const s = samples(itemId);
  const nearest = [...s].sort((a, b) => a.distanceM - b.distanceM)[0];
  const best = s[0];
  if (!nearest || !best || best.shopId === nearest.shopId || best.priceCents >= nearest.priceCents) return null;
  const pct = Math.round(((nearest.priceCents - best.priceCents) / nearest.priceCents) * 100);
  return {
    shopId: best.shopId,
    headline: `Tomatoes ${pct}% cheaper ${best.distanceM} m away`,
    reason: `${best.name} has them for ${formatMoney(best.priceCents)} a kg; ${nearest.name} is at ${formatMoney(nearest.priceCents)}.`,
  };
}

/** Consecutive days with a haggle, counting back from today. */
function streakDays(ts: number[]): number {
  const days = new Set(ts.map((t) => new Date(t).toDateString()));
  let n = 0;
  const d = new Date();
  while (days.has(d.toDateString())) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
