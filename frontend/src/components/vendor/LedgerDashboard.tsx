import { useEffect, useState } from 'react';
import { useInventory } from '@/stores/inventory';
import { useSession } from '@/stores/session';
import { getLedger, type Ledger, type LedgerPeriod, type LedgerRow } from '@/lib/backend';
import { formatMoney, formatMoneyWhole } from '@/lib/money';
import { roundQty } from '@/lib/units';
import { cn } from '@/lib/cn';

const PERIODS: Array<{ id: LedgerPeriod; label: string }> = [
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: 'all', label: 'All' },
];

function useLedger(period: LedgerPeriod): { ledger: Ledger | null; loading: boolean } {
  const token = useSession((s) => s.token);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    if (!token) {
      setLedger(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    getLedger(token, period)
      .then((l) => { if (!cancelled) setLedger(l); })
      .catch(() => { if (!cancelled) setLedger(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, period]);
  return { ledger, loading };
}

/** Vendor dashboard: real KPIs, margin/revenue rankings and recent deals from the backend's Merchant Ledger. */
export default function LedgerDashboard() {
  const [period, setPeriod] = useState<LedgerPeriod>('30d');
  const { ledger, loading } = useLedger(period);
  const lowStock = useInventory((s) => s.items).filter((i) => !i.archived && i.quantity != null && i.quantity <= (i.lowStockAt ?? 0));

  return (
    <div className="grid gap-6 pb-32">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="t-label">Vendor console</p>
          <h1 className="t-h1">Ledger</h1>
        </div>
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
      </header>

      {loading && <p className="surface p-6 text-center text-sm text-ink-faint">Loading your ledger…</p>}

      {!loading && !ledger && (
        <p className="surface p-6 text-center text-sm text-ink-faint">
          No real shop yet, or the ledger couldn't be reached. Set up your stall to see real sales here.
        </p>
      )}

      {ledger && (
        <>
          <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Revenue" value={formatMoneyWhole(ledger.kpis.revenueCents, ledger.currency)} />
            <Kpi label="Margin kept" value={formatMoneyWhole(ledger.kpis.marginKeptCents, ledger.currency)} />
            <Kpi label="Deals won" value={`${ledger.kpis.deals.won}`} sub={`${ledger.kpis.deals.lost} lost · ${ledger.kpis.deals.winRatePct}% win`} />
            <Kpi label="Avg. discount" value={`${ledger.kpis.avgDiscountPct}%`} sub="off sticker, won deals" />
            <Kpi label="Avg. fairness" value={ledger.kpis.avgFairness != null ? `${ledger.kpis.avgFairness}%` : '—'} sub={`${ledger.kpis.proofVerifiedRatePct}% proof verified`} />
          </section>

          {ledger.widgets.dealFunnel.some((f) => f.count > 0) && (
            <section aria-labelledby="funnel-h" className="grid gap-3 surface p-4 sm:p-6">
              <h2 id="funnel-h" className="font-display text-xl text-ink">Deal funnel</h2>
              <div className="flex flex-wrap gap-3">
                {ledger.widgets.dealFunnel.map((f) => (
                  <div key={f.stage} className="grid gap-1 surface-soft p-3">
                    <p className="t-label">{f.label}</p>
                    <p className="font-mono text-lg font-semibold text-ink">{f.count}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section aria-label="Rankings" className="grid gap-4 sm:grid-cols-2">
            <BarCard title="Top by revenue" bars={ledger.widgets.revenueByItem} currency={ledger.currency} />
            <BarCard title="Top by margin kept" bars={ledger.widgets.marginByItem} currency={ledger.currency} />
          </section>

          {lowStock.length > 0 && (
            <section aria-label="Low stock" className="grid gap-2 surface p-4">
              <h2 className="text-sm font-semibold text-ink">Low stock</h2>
              <ul className="grid gap-1.5 text-sm">
                {lowStock.map((i) => (
                  <li key={i.id} className="flex justify-between gap-2">
                    <span className="truncate text-ink">{i.emoji ?? '🛒'} {i.name}</span>
                    <span className="shrink-0 tabular-nums text-ink-faint">{roundQty(i.quantity ?? 0)} {i.unit ?? ''} left</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="rows-h" className="grid gap-2 surface p-4">
            <h2 id="rows-h" className="text-sm font-semibold text-ink">Recent deals</h2>
            {ledger.rows.length === 0 ? (
              <p className="text-sm text-ink-faint">No deals in this period.</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {ledger.rows.slice(0, 20).map((r) => (
                  <RowLine key={r.id} r={r} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
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

function BarCard({ title, bars, currency }: { title: string; bars: Array<{ label: string; valueCents: number; count: number }>; currency: string }) {
  return (
    <div className="grid gap-2 surface p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {bars.length === 0 ? (
        <p className="text-sm text-ink-faint">Nothing yet this period.</p>
      ) : (
        <ol className="grid gap-2">
          {bars.slice(0, 8).map((b) => (
            <li key={b.label} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-ink">{b.label}</span>
              <span className="shrink-0 text-right">
                <span className="block font-semibold tabular-nums text-ink">{formatMoney(b.valueCents, currency)}</span>
                <span className="block text-[11px] text-ink-faint">{b.count} deal{b.count === 1 ? '' : 's'}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function RowLine({ r }: { r: LedgerRow }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate text-ink">
        {r.emoji ?? '🛒'} {r.name} × {roundQty(r.qty)}
      </span>
      <span className={cn('shrink-0 tabular-nums', r.won ? 'text-teal' : 'text-ink-faint')}>
        {r.won && r.lineCents != null ? formatMoney(r.lineCents, r.currency) : 'no deal'}
      </span>
    </li>
  );
}
