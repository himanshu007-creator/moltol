import { useEffect, useMemo, useState } from 'react';
import { useInventory } from '@/stores/inventory';
import { useLedger } from '@/stores/ledger';
import { useSession } from '@/stores/session';
import { getLedgerSummary, type LedgerSummary } from '@/lib/backend';
import { computeLedger, DEAD_STOCK_DAYS, type ItemRow, type Hint } from '@/lib/ledger';
import { formatMoney, formatMoneyWhole } from '@/lib/money';
import { roundQty } from '@/lib/units';
import { cn } from '@/lib/cn';
import PeriodChart from '@/components/vendor/PeriodChart';

/**
 * Real numbers from the backend's Merchant Ledger (`GET /v1/ledger/summary`),
 * for a seller with a real shop and at least one real sale. The grid/widget
 * dashboard (AG Grid Studio) that normally binds to the full `/v1/ledger` is
 * its own, larger build — see BE_MISSING_THINGS.md's sponsor-integration
 * writeup — this is the honest, scoped piece: real KPIs surfaced next to the
 * existing local-estimate dashboard below, which keeps working unchanged.
 */
function useRealLedgerSummary(): LedgerSummary | null {
  const token = useSession((s) => s.token);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  useEffect(() => {
    setSummary(null);
    if (!token) return;
    let cancelled = false;
    getLedgerSummary(token)
      .then((s) => { if (!cancelled) setSummary(s); })
      .catch(() => {}); // no real shop yet, or backend unreachable — local estimates stand alone
    return () => { cancelled = true; };
  }, [token]);
  return summary;
}

type Period = 'byDay' | 'byWeek' | 'byMonth';
const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'byDay', label: 'Day' },
  { id: 'byWeek', label: 'Week' },
  { id: 'byMonth', label: 'Month' },
];

/** Modern vendor dashboard: KPIs, period chart, rankings, dead and low stock, and health hints. */
export default function LedgerDashboard() {
  const items = useInventory((s) => s.items);
  const deals = useLedger((s) => s.deals);
  const adjust = useInventory((s) => s.adjust);
  const update = useInventory((s) => s.update);
  const [period, setPeriod] = useState<Period>('byDay');
  const [applied, setApplied] = useState<string[]>([]);

  const L = useMemo(() => computeLedger(items, deals), [items, deals]);
  const k = L.kpis;
  const real = useRealLedgerSummary();

  const apply = (h: Hint) => {
    const it = items.find((i) => i.id === h.sku);
    if (!it) return;
    if (h.action.restock) adjust(h.sku, h.action.restock, 'Restock');
    if (h.action.patch) update(h.sku, h.action.patch);
    setApplied((a) => [...a, h.id]);
  };
  const hints = L.hints.filter((h) => !applied.includes(h.id));

  return (
    <div className="grid gap-6 pb-32">
      <header>
        <p className="t-label">Vendor console</p>
        <h1 className="t-h1">Ledger</h1>
        <p className="mt-1 text-sm text-ink-faint">Last 90 days of demo deals. Figures are estimates until the backend is wired.</p>
      </header>

      {real && real.kpis.deals.total > 0 && (
        <section aria-label="Real sales from your shop" className="surface-accent grid gap-3 p-4 sm:p-5">
          <p className="t-label !text-[#5b3200]">Live from your shop ({real.window.period})</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Revenue" value={formatMoneyWhole(real.kpis.revenueCents, real.currency)} />
            <Kpi label="Margin kept" value={formatMoneyWhole(real.kpis.marginKeptCents, real.currency)} />
            <Kpi label="Deals won" value={`${real.kpis.deals.won}`} sub={`${real.kpis.deals.winRatePct}% win rate`} />
            <Kpi label="Avg. fairness" value={real.kpis.avgFairness != null ? `${real.kpis.avgFairness}%` : '—'} />
          </div>
        </section>
      )}

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Revenue" value={formatMoneyWhole(k.revenueCents)} />
        <Kpi label="Profit" value={formatMoneyWhole(k.profitCents)} sub={`${k.marginPct}% margin`} />
        <Kpi label="Kept vs list" value={`${k.listKeptPct}%`} sub="of sticker value" />
        <Kpi label="Deals closed" value={`${k.won}`} sub={`${k.lost} lost · ${k.winRatePct}% win`} />
        <div className="grid gap-1 surface p-4">
          <p className="t-label">Peak hours</p>
          <div className="flex flex-wrap gap-1">
            {L.peakHours.map((p) => (
              <span key={p.hour} className="rounded-full bg-paper-3 px-2 py-0.5 font-mono text-xs text-ink">{p.hour}:00</span>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="trend-h" className="grid gap-3 surface p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="trend-h" className="font-display text-xl text-ink">Revenue and profit</h2>
          <div role="group" aria-label="Period" className="flex rounded-2xl bg-paper-3 p-1">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={period === p.id}
                onClick={() => setPeriod(p.id)}
                className={cn('min-h-11 rounded-xl px-4 text-sm font-semibold', period === p.id ? 'bg-ink text-paper' : 'text-ink')}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <PeriodChart data={L[period]} label={`Revenue by ${PERIODS.find((p) => p.id === period)?.label.toLowerCase()}`} />
      </section>

      <section aria-labelledby="health-h" className="grid gap-3">
        <h2 id="health-h" className="font-display text-xl text-ink">Inventory health</h2>
        {hints.length === 0 ? (
          <p className="surface p-4 text-sm text-ink-faint">Nothing needs attention right now.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {hints.map((h) => (
              <li key={h.id} className="grid gap-2 surface p-4">
                <p className="font-semibold text-ink">{h.headline}</p>
                <p className="text-sm text-ink-faint">{h.reason}</p>
                <button type="button" onClick={() => apply(h)} className="min-h-11 w-fit rounded-2xl bg-marigold px-4 py-2 text-sm font-semibold text-[#23180a]">
                  {h.action.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Rankings" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <RankCard title="Most sold" rows={L.mostSold} value={(r) => formatMoney(r.revenueCents)} sub={(r) => `${roundQty(r.unitsSold)} ${r.unit}`} />
        <RankCard title="Least sold" rows={L.leastSold} value={(r) => formatMoney(r.revenueCents)} sub={(r) => `${roundQty(r.unitsSold)} ${r.unit}`} />
        <RankCard title="Highest profit" rows={L.highestProfit} value={(r) => formatMoney(r.profitCents)} sub={(r) => `${r.marginPct}% margin`} />
        <RankCard title="Lowest margin" rows={L.lowestMargin} value={(r) => `${r.marginPct}%`} sub={(r) => formatMoney(r.profitCents) + ' profit'} />
      </section>

      <section aria-label="Stock alerts" className="grid gap-4 md:grid-cols-2">
        <ListCard
          title={`Dead stock (no sale in ${DEAD_STOCK_DAYS} days)`}
          empty="No dead stock. Everything moved recently."
          rows={L.deadStock}
          right={(r) => `${roundQty(r.stock)} ${r.unit}`}
        />
        <ListCard title="Low stock" empty="Nothing running low." rows={L.lowStock} right={(r) => `${roundQty(r.stock)} ${r.unit} left`} />
      </section>

      <section aria-labelledby="cust-h" className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2 surface p-4">
          <h2 id="cust-h" className="text-sm font-semibold text-ink">Repeat customers</h2>
          {L.repeatCustomers.length === 0 ? (
            <p className="text-sm text-ink-faint">No repeat buyers yet.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {L.repeatCustomers.map((c) => (
                <li key={c.first} className="flex justify-between">
                  <span className="text-ink">{c.first}</span>
                  <span className="tabular-nums text-ink-faint">{c.visits} deals · {formatMoney(c.spentCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid gap-2 surface p-4">
          <h2 className="text-sm font-semibold text-ink">Revenue by item</h2>
          <ul className="grid gap-1 text-sm">
            {L.rows
              .slice()
              .sort((a, b) => b.revenueCents - a.revenueCents)
              .slice(0, 8)
              .map((r) => (
                <li key={r.sku} className="flex items-center justify-between gap-2">
                  <span className="truncate text-ink">{r.emoji} {r.name}</span>
                  <span className="shrink-0 tabular-nums text-ink-faint">{formatMoney(r.revenueCents)} · {r.listKeptPct}% of list</span>
                </li>
              ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="grid gap-1 surface p-4">
      <p className="t-label">{label}</p>
      <p className="truncate font-mono text-lg font-semibold tabular-nums text-ink sm:text-xl">{value}</p>
      {sub && <p className="text-xs text-ink-faint">{sub}</p>}
    </div>
  );
}

function RankCard({ title, rows, value, sub }: { title: string; rows: ItemRow[]; value: (r: ItemRow) => string; sub: (r: ItemRow) => string }) {
  return (
    <div className="grid gap-2 surface p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <ol className="grid gap-2">
        {rows.map((r) => (
          <li key={r.sku} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-ink">{r.emoji} {r.name}</span>
            <span className="shrink-0 text-right">
              <span className="block font-semibold tabular-nums text-ink">{value(r)}</span>
              <span className="block text-[11px] text-ink-faint">{sub(r)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ListCard({ title, rows, empty, right }: { title: string; rows: ItemRow[]; empty: string; right: (r: ItemRow) => string }) {
  return (
    <div className="grid gap-2 surface p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-faint">{empty}</p>
      ) : (
        <ul className="grid gap-1.5 text-sm">
          {rows.map((r) => (
            <li key={r.sku} className="flex justify-between gap-2">
              <span className="truncate text-ink">{r.emoji} {r.name}</span>
              <span className="shrink-0 tabular-nums text-ink-faint">{right(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
