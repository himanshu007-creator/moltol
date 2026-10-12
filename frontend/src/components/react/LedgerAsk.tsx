import { useMemo, useState } from 'react';
import { DEALS, totalCents } from '@/lib/deals';
import { formatMoney } from '@/lib/money';
import { button, input as inputCls, mono } from '@/lib/ui';
import { cn } from '@/lib/cn';

type Answer = { label: string; lines: Array<{ left: string; right: string }> };

function respond(q: string): Answer {
  const s = q.toLowerCase();
  if (s.includes('below') || s.includes('kam') || s.includes('down') || s.includes('discount')) {
    const below = DEALS.filter((d) => d.soldCents < d.listCents);
    return {
      label: `${below.length} deals closed below list price today`,
      lines: below.map((d) => ({
        left: `${d.emoji} ${d.item}`,
        right: formatMoney(d.soldCents),
      })),
    };
  }
  if (s.includes('top') || s.includes('best') || s.includes('sabse')) {
    const top = [...DEALS].sort((a, b) => b.soldCents - a.soldCents).slice(0, 3);
    return {
      label: 'Your top sellers today',
      lines: top.map((d) => ({ left: `${d.emoji} ${d.item}`, right: formatMoney(d.soldCents) })),
    };
  }
  const total = totalCents(DEALS);
  return {
    label: 'Here’s the today picture',
    lines: [
      { left: 'Deals today', right: `${DEALS.length}` },
      { left: 'Total today', right: formatMoney(total) },
      { left: 'Avg. squeeze', right: '12% below list' },
    ],
  };
}

export default function LedgerAsk() {
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);

  const suggested = useMemo(
    () => [
      'deals below list this week',
      'top sellers today',
      'today’s total',
    ],
    [],
  );

  const ask = (text: string) => {
    setQ(text);
    setAnswer(respond(text));
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) ask(q);
        }}
        className="flex gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask your ledger…"
          className={inputCls}
        />
        <button type="submit" className={button('primary')}>
          Ask
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {suggested.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => ask(s)}
            className="rounded-full border border-chalk bg-paper-2 px-3 py-1.5 text-xs text-ink-muted hover:text-ink"
          >
            {s}
          </button>
        ))}
      </div>

      {answer && (
        <div className="surface p-4">
          <p className="text-sm font-semibold text-ink">{answer.label}</p>
          <dl className="mt-3 space-y-2">
            {answer.lines.map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-4 border-b border-chalk/60 pb-2 text-sm last:border-0">
                <dt className="text-ink-muted">{l.left}</dt>
                <dd className={cn(mono, 'text-ink')}>{l.right}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}