import { useSimple } from '@/stores/simple';
import { s, nativeRupaye, nativeNum } from '@/lib/simple/strings';
import { SELLER_DAYS } from '@/lib/mock/seeds';

export default function SimpleEarnings() {
  const { todayEarningsCents, dealsLog, language } = useSimple();
  const dict = s(language);
  const max = Math.max(...SELLER_DAYS.map((d) => d.earnCents));
  const top = [...dealsLog].sort((a, b) => b.cents - a.cents).slice(0, 3);

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6">
      <h1 className="text-2xl font-semibold text-ink">{dict.u.earningsToday}</h1>

      <div className="mt-4 rounded-[2.5rem] bg-teal/12 p-6 ring-4 ring-teal/10">
        <p className="text-2xl font-black text-ink">{nativeRupaye(todayEarningsCents, language)}</p>
        <p className="mt-1 text-sm text-ink-faint">{dict.u.homeEarnings}</p>
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-faint">{dict.u.earningsWeek}</h2>
      <div className="mt-3 flex h-40 items-end gap-2 surface p-4">
        {SELLER_DAYS.map((d) => (
          <div key={d.d} className="flex flex-1 flex-col items-center gap-1">
            <span className="w-full rounded-full bg-chili/80" style={{ height: `${Math.max(6, (d.earnCents / max) * 100)}%` }} />
            <span className="text-[10px] text-ink-faint">{d.d}</span>
          </div>
        ))}
      </div>

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