import type { ReactNode } from 'react';
import { useSimple } from '@/stores/simple';
import { nativeNum } from '@/lib/simple/strings';
import { cn } from '@/lib/cn';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export function Numpad({
  value,
  onChange,
  max = 10,
  prefix = '',
  renderValue,
  contentSlot,
  onSubmit,
}: {
  value: string;
  onChange: (digits: string) => void;
  max?: number;
  prefix?: ReactNode;
  renderValue?: (digits: string) => string;
  contentSlot?: ReactNode;
  onSubmit?: () => void;
}) {
  const language = useSimple((x) => x.language);
  const tap = (k: string) => {
    if (value.replace(/\D/g, '').length >= max) return;
    onChange(value.replace(/\D/g, '') + k);
  };
  const back = () => onChange(value.replace(/\D/g, '').slice(0, -1));
  const shown = renderValue ? renderValue(value.replace(/\D/g, '')) : nativeNum(value.replace(/\D/g, '') || '0', language);

  return (
    <div className="flex flex-col">
      {contentSlot}

      <div className="flex min-h-24 items-center justify-end gap-2 overflow-hidden surface px-5">
        <span aria-hidden="true" className="text-3xl leading-none">
          {prefix}
        </span>
        <span
          aria-live="polite"
          className="flex-1 overflow-hidden text-right text-5xl font-semibold tabular-nums tracking-tight text-ink"
        >
          {shown}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => tap(k)}
            className="flex h-16 items-center justify-center surface text-2xl font-medium text-ink active:scale-95"
          >
            {nativeNum(k, language)}
          </button>
        ))}
        <button
          type="button"
          onClick={back}
          aria-label="Delete"
          className="flex h-16 items-center justify-center rounded-2xl bg-paper-3 text-xl text-ink-muted active:scale-95"
        >
          ⌫
        </button>
        <button
          type="button"
          onClick={() => tap('0')}
          className={cn('flex h-16 items-center justify-center rounded-2xl text-2xl font-medium active:scale-95', 'bg-paper-2 text-ink')}
        >
          {nativeNum('0', language)}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!value.replace(/\D/g, '').length}
          className="flex h-16 items-center justify-center rounded-2xl bg-marigold text-2xl text-[#23180a] active:scale-95 disabled:opacity-40"
          aria-label="Submit number"
        >
          ✓
        </button>
      </div>
    </div>
  );
}