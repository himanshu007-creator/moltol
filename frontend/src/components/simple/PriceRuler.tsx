import { useSimple } from '@/stores/simple';
import { nativeRupaye } from '@/lib/simple/strings';
import { speakRupaye } from '@/lib/voice';

/**
 * Vertical price ruler with a red minimum line. The red zone below the line is
 * "never below this": the stall agent is forbidden to cross it. One draggable
 * handle (touch + keyboard via <input type=range>), two big readout markers.
 */
export default function PriceRuler({
  valueCents,
  minCents,
  maxCents,
  sellCents,
  onChange,
  label,
}: {
  valueCents: number;
  minCents: number;
  maxCents: number;
  sellCents: number;
  onChange: (cents: number) => void;
  label: string;
}) {
  const language = useSimple((x) => x.language);
  const mute = useSimple((x) => x.mute);
  const pct = (v: number) => ((v - minCents) / (maxCents - minCents)) * 100;
  const line = Math.max(0, Math.min(100, pct(valueCents)));
  const sell = Math.max(0, Math.min(100, pct(sellCents)));

  const speak = (cents: number) => {
    speakRupaye(cents, language, { mute });
  };

  return (
    <div className="flex items-stretch gap-4">
      <div className="relative h-64 flex-1 touch-none">
        {/* track + red zone */}
        <div className="absolute inset-x-4 bottom-0 top-0 overflow-hidden rounded-full">
          <div className="absolute inset-0 rounded-full bg-paper-3" />
          <div
            className="absolute inset-x-0 bottom-0 bg-chili/25"
            style={{ height: `${line}%` }}
            aria-hidden="true"
          />
          <div className="absolute inset-x-0 rounded-full bg-paper-3" style={{ top: '20%' }} aria-hidden="true" />
        </div>

        {/* marigold sell marker (fixed) */}
        <div
          className="absolute inset-x-0 flex flex-col items-center"
          style={{ bottom: `calc(${sell}% - 1.6rem)` }}
          aria-hidden="true"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-marigold">You sell</span>
          <span className="h-3 w-full rounded-full bg-marigold drop-shadow" />
        </div>

        {/* red line = the value being set */}
        <div
          className="absolute inset-x-0 flex flex-col items-center"
          style={{ bottom: `calc(${line}% - 1.6rem)` }}
          aria-hidden="true"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-chili">
            {label}
          </span>
          <span className="h-1.5 w-full rounded-full bg-chili shadow-[0_0_0_3px_rgba(206,64,54,0.25)]" />
        </div>

        {/* the input — full-height thumb target */}
        <input
          type="range"
          min={minCents}
          max={maxCents}
          step={100}
          value={valueCents}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={() => speak(valueCents)}
          aria-label={label}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:h-14 [&::-webkit-slider-thumb]:w-10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-2xl [&::-webkit-slider-thumb]:bg-transparent"
        />

        {/* big readouts */}
        <div className="pointer-events-none absolute inset-x-0 top-1 flex justify-between text-xs text-ink-faint">
          <span>{nativeRupaye(maxCents, language)}</span>
          <span className="font-semibold text-ink">{nativeRupaye(valueCents, language)}</span>
        </div>
      </div>

      <div className="flex w-32 flex-col justify-between text-sm">
        <div>
          <p className="text-xs text-ink-faint">Your price</p>
          <p className="text-xl font-semibold text-marigold">
            {nativeRupaye(sellCents, language)}
          </p>
        </div>
        <div>
          <p className="text-xs text-ink-faint">{label}</p>
          <p className="text-2xl font-bold text-chili">{nativeRupaye(valueCents, language)}</p>
          <button
            type="button"
            onClick={() => speak(valueCents)}
            className="mt-1 rounded-full bg-paper-2 px-3 py-1.5 text-xs font-medium text-ink"
          >
            🔊 say it
          </button>
        </div>
      </div>
    </div>
  );
}