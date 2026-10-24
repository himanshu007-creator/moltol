import { useEffect, useState } from 'react';
import { useSession } from '@/stores/session';
import { getBuyerInsights, type BuyerInsights } from '@/lib/backend';
import { formatMoneyWhole } from '@/lib/money';
import HaggleStyleCard from '@/components/buyer/HaggleStyleCard';

const CARD_ICON: Record<BuyerInsights['cards'][number]['kind'], string> = {
  savings: '💸',
  streak: '🔥',
  budget: '🎯',
  fairness: '⚖️',
  shops: '🏪',
  spend: '🧺',
};

function useRealInsights(): { insights: BuyerInsights | null; loading: boolean } {
  const token = useSession((s) => s.token);
  const [insights, setInsights] = useState<BuyerInsights | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    if (!token) {
      setInsights(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    getBuyerInsights(token)
      .then((i) => { if (!cancelled) setInsights(i); })
      .catch(() => { if (!cancelled) setInsights(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);
  return { insights, loading };
}

/** Buyer insights: real numbers from `GET /v1/insights/buyer`. */
export default function Insights() {
  const { insights, loading } = useRealInsights();

  return (
    <div className="grid gap-6 pb-32">
      <header>
        <h1 className="t-h1">Your wins</h1>
        <p className="text-sm text-ink-faint">From your real haggles and orders.</p>
      </header>

      {loading && <p className="surface p-6 text-center text-sm text-ink-faint">Loading your insights…</p>}

      {!loading && (!insights || insights.orders === 0) && (
        <p className="surface p-6 text-center text-sm text-ink-faint">
          Haggle and pay for your first basket to see your wins here.
        </p>
      )}

      {insights && insights.orders > 0 && (
        <>
          <section aria-label="Key numbers" className="grid grid-cols-2 gap-3">
            {insights.cards.map((c) => (
              <div key={c.kind} className="surface p-4">
                <span className="text-2xl" aria-hidden="true">{CARD_ICON[c.kind]}</span>
                <p className="mt-1 font-mono text-xl font-black tabular-nums text-ink">{c.title}</p>
                <p className="text-[11px] text-ink-faint">{c.detail}</p>
              </div>
            ))}
          </section>

          <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Orders" value={String(insights.orders)} />
            <Stat label="Total spent" value={formatMoneyWhole(insights.totalSpentCents)} />
            <Stat label="Total saved" value={formatMoneyWhole(insights.totalSavedCents)} />
            <Stat label="Avg. fairness" value={insights.avgFairness != null ? `${insights.avgFairness}%` : '—'} />
          </section>
        </>
      )}

      <HaggleStyleCard />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 surface p-4">
      <p className="t-label">{label}</p>
      <p className="truncate font-mono text-lg font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}
