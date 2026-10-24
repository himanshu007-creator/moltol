import { useEffect, useState } from 'react';
import { useSimple } from '@/stores/simple';
import { useSession } from '@/stores/session';
import { getLedger } from '@/lib/backend';
import { s, nativeRupaye, nativeNum } from '@/lib/simple/strings';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Real earnings per weekday, last 7 days, from the backend's Merchant Ledger. */
function useWeekEarnings(): number[] | null {
  const token = useSession((s) => s.token);
  const [days, setDays] = useState<number[] | null>(null);
  useEffect(() => {
    setDays(null);
    if (!token) return;
    let cancelled = false;
    getLedger(token, '7d')
      .then((ledger) => {
        if (cancelled) return;
        const buckets = new Array(7).fill(0) as number[];
        for (const r of ledger.rows) {
          if (!r.won || r.lineCents == null) continue;
          buckets[new Date(r.ts).getDay()] += r.lineCents;
        }
        setDays(buckets);
      })
      .catch(() => { if (!cancelled) setDays(null); });
    return () => { cancelled = true; };
  }, [token]);
  return days;
}

export default function SimpleEarnings() {
  const { todayEarningsCents, dealsLog, language } = useSimple();
  const dict = s(language);
  const week = useWeekEarnings();
  const max = week ? Math.max(1, ...week) : 1;
  const top = [...dealsLog].sort((a, b) => b.cents - a.cents).slice(0, 3);

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6">
      <h1 className="text-2xl font-semibold text-ink">{dict.u.earningsToday}</h1>

      <div className="mt-4 rounded-[2.5rem] bg-teal/12 p-6 ring-4 ring-teal/10">
        <p className="text-2xl font-black text-ink">{nativeRupaye(todayEarningsCents, language)}</p>
        <p className="mt-1 text-sm text-ink-faint">{dict.u.homeEarnings}</p>
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-faint">{dict.u.earningsWeek}</h2>
      {week ? (
        <div className="mt-3 flex h-40 items-end gap-2 surface p-4">
          {week.map((cents, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <span className="w-full rounded-full bg-chili/80" style={{ height: `${Math.max(6, (cents / max) * 100)}%` }} />
              <span className="text-[10px] text-ink-faint">{DAY_LABELS[i]}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 surface p-4 text-sm text-ink-faint">No real sales yet this week.</p>
      )}

      {top.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-faint">Top · today</h2>
          <div className="mt-3 grid gap-2">
            {top.map((t) => (
              <div key={t.ts} className="flex items-center gap-3 surface p-3">
                <span className="text-2xl">{t.emoji}</span>
                <span className="flex-1 text-sm font-medium text-ink">{t.item}</span>
                <span className="font-semibold text-teal">{nativeRupaye(t.cents, language)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="mt-8 text-center text-xs text-ink-faint">{nativeNum(dealsLog.length, language)} {dict.u.homeDeals} 🪔</p>
    </div>
  );
}
