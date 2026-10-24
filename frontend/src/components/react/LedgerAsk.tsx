import { useMemo, useState } from 'react';
import { askLedger, type LedgerAnswer } from '@/lib/backend';
import { useSession } from '@/stores/session';
import { button, input as inputCls, mono } from '@/lib/ui';
import { cn } from '@/lib/cn';

type Answer = { label: string; facts: string[]; source: LedgerAnswer['source'] };

export default function LedgerAsk() {
  const token = useSession((s) => s.token);
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const suggested = useMemo(
    () => [
      'deals below list this week',
      'top sellers today',
      'today’s total',
    ],
    [],
  );

  const ask = async (text: string) => {
    setQ(text);
    if (!token) {
      setError('Log in to ask your ledger.');
      return;
    }
    setAsking(true);
    setError(null);
    try {
      const real = await askLedger(token, text);
      setAnswer({ label: real.answer, facts: real.facts, source: real.source });
    } catch {
      setAnswer(null);
      setError("Couldn't reach your ledger — set up your stall first, or try again.");
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) void ask(q);
        }}
        className="flex gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Try: below, top sellers, total…"
          className={inputCls}
        />
        <button type="submit" className={button('primary')} disabled={asking}>
          {asking ? 'Asking…' : 'Ask'}
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {suggested.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void ask(s)}
            className="rounded-full border border-chalk bg-paper-2 px-3 py-1.5 text-xs text-ink-muted hover:text-ink"
          >
            {s}
          </button>
        ))}
      </div>

      {error && <p className="surface p-4 text-sm text-ink-faint">{error}</p>}

      {answer && (
        <div className="surface p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">{answer.label}</p>
            <span className="shrink-0 rounded-full bg-paper-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              {answer.source === 'hybrid' ? 'AI + your ledger' : answer.source === 'paypal' ? 'PayPal' : 'your ledger'}
            </span>
          </div>
          {answer.facts.length > 0 && (
            <dl className="mt-3 space-y-2">
              {answer.facts.map((f, i) => (
                <div key={i} className="border-b border-chalk/60 pb-2 text-sm last:border-0">
                  <dd className={cn(mono, 'text-ink')}>{f}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
