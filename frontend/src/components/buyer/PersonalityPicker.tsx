import { PRESET_ORDER, PRESETS, presetAt, type PresetId } from '@/lib/personality';
import { cn } from '@/lib/cn';

/**
 * Haggle style: three cards plus a slider, with the trade-off in plain words.
 * Controlled, so the cart can override per haggle and Insights can save the default.
 */
export default function PersonalityPicker({ value, onChange, compact = false }: { value: PresetId; onChange: (p: PresetId) => void; compact?: boolean }) {
  const p = PRESETS[value];
  const pos = PRESET_ORDER.indexOf(value);
  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label="Haggle style" className={cn('grid gap-2', !compact && 'sm:grid-cols-3')}>
        {PRESET_ORDER.map((id) => {
          const x = PRESETS[id];
          const on = id === value;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(id)}
              className={cn(
                'min-h-14 rounded-2xl border p-3 text-left transition active:scale-[0.99]',
                on ? 'border-chili bg-chili/10 ring-2 ring-chili/40' : 'border-chalk bg-paper-2',
              )}
            >
              <span className="block text-sm font-semibold text-ink">{x.label}</span>
              <span className="block text-xs text-ink-faint">{x.blurb}</span>
            </button>
          );
        })}
      </div>
      <label className="grid gap-1">
        <span className="sr-only">Haggle intensity</span>
        <input
          type="range"
          min={0}
          max={2}
          step={1}
          value={pos}
          onChange={(e) => onChange(presetAt(Number(e.target.value)))}
          className="h-11 accent-chili"
          aria-valuetext={p.label}
        />
      </label>
      <p className="text-sm text-ink" aria-live="polite">
        <span className="font-semibold">~{p.estSeconds} s</span> per item · usually saves <span className="font-semibold">~{p.estSavePct}%</span>{' '}
        <span className="text-xs text-ink-faint">(estimate)</span>
      </p>
    </div>
  );
}
