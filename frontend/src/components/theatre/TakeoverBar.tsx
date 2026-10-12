import { useState } from 'react';
import { Hand, Send, Undo2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { button, input as inputCls, label as labelCls, mono } from '@/lib/ui';
import { formatMoney, parseMoneyToCents } from '@/lib/money';
import { useI18n } from '@/stores/prefs';

/**
 * Takeover bar (FE_plan §6.4). A human can step in for the buyer agent; the
 * mandate still caps the offer client-side, so the UI can never break policy.
 */
export function TakeoverBar({
  active,
  takeover,
  currency,
  mandateCents,
  suggestedCents,
  onToggle,
  onSend,
}: {
  active: boolean;
  takeover: boolean;
  currency: string;
  mandateCents: number;
  suggestedCents: number;
  onToggle: (on: boolean) => void;
  onSend: (cents: number) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(() => (suggestedCents / 100).toFixed(2));

  if (!active) return null;

  if (!takeover) {
    return (
      <div className="sticky bottom-0 z-20 -mx-1 mt-4 border-t border-chalk/60 bg-paper/85 px-1 pb-safe pt-3 backdrop-blur">
        <button
          type="button"
          onClick={() => {
            setValue((suggestedCents / 100).toFixed(2));
            onToggle(true);
          }}
          className={cn(button('secondary'), 'w-full')}
        >
          <Hand className="h-4 w-4" aria-hidden="true" />
          {t('theatre.takeover')}
        </button>
      </div>
    );
  }

  const cents = parseMoneyToCents(value) ?? 0;
  const over = cents > mandateCents;
  const valid = cents > 0 && !over;
  const step = (delta: number) => {
    const next = Math.max(50, cents + delta);
    setValue((next / 100).toFixed(2));
  };

  return (
    <div className="sticky bottom-0 z-20 -mx-1 mt-4 border-t border-chalk/60 bg-paper/90 px-1 pb-safe pt-3 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-marigold">
          {t('theatre.youNow')}
        </span>
        <button
          type="button"
          onClick={() => onToggle(false)}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t('theatre.release')}
        </button>
      </div>

      <div className="mt-2 flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="offer-input" className={cn(labelCls, 'mb-1')}>
            {t('theatre.yourOffer')}
          </label>
          <div className="flex items-stretch gap-1.5">
            <button
              type="button"
              onClick={() => step(-100)}
              className={cn(button('secondary'), 'min-h-11 px-3')}
              aria-label="decrease by one"
            >
              −
            </button>
            <input
              id="offer-input"
              inputMode="decimal"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={cn(inputCls, 'text-center')}
              aria-invalid={over}
              aria-describedby="offer-help"
            />
            <button
              type="button"
              onClick={() => step(100)}
              className={cn(button('secondary'), 'min-h-11 px-3')}
              aria-label="increase by one"
            >
              +
            </button>
          </div>
        </div>
        <button
          type="button"
          disabled={!valid}
          onClick={() => valid && onSend(cents)}
          className={cn(button('primary'), 'min-h-11 shrink-0')}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t('theatre.send')}</span>
        </button>
      </div>

      <p id="offer-help" className="mt-1.5 text-xs text-ink-faint">
        {over ? (
          <span className="text-chili">
            Above your sealed ceiling ({formatMoney(mandateCents, currency)}). The agent won’t allow it.
          </span>
        ) : (
          <>
            Ceiling <span className={cn(mono, 'text-ink-muted')}>{formatMoney(mandateCents, currency)}</span> — kept
            private from the shop.
          </>
        )}
      </p>
    </div>
  );
}
