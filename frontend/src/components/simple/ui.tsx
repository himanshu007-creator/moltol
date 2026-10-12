import type { ReactNode } from 'react';
import { useSimple } from '@/stores/simple';
import { s } from '@/lib/simple/strings';
import { speak } from '@/lib/voice';

/** Primary action — full width, ≥64px tall, thumb-reachable, bottom slot. */
export function BigButton({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'danger' | 'ghost';
}) {
  const cls = variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-chili' : 'btn-quiet';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`btn ${cls} !min-h-16 w-full !text-lg`}
    >
      {children}
    </button>
  );
}

/** The spoken line, always shown as a caption too. Tap = replay. */
export function VoiceCaption({ voice, mute }: { voice: string; mute?: boolean }) {
  const language = useSimple((x) => x.language);
  const soundOn = (mute ?? useSimple((x) => x.mute)) === false;
  return (
    <div className="surface flex items-start gap-4 p-5">
      <button
        type="button"
        onClick={() => voice && speak(voice, language, { mute: !soundOn })}
        aria-label="Replay"
        className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-marigold/25 text-xl"
      >
        🔊
      </button>
      <p aria-live="polite" className="pt-2 text-xl leading-snug text-ink">
        {voice}
      </p>
    </div>
  );
}

/** Round helper for the numpad / mic actions. */
export function RoundBtn({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="surface grid h-16 w-full place-items-center text-2xl transition active:scale-95"
    >
      {icon}
    </button>
  );
}

/** ≤5 step indicator for setup. */
export function Steps({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex gap-2" role="list" aria-label="Step">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          aria-current={i === current ? 'step' : undefined}
          className={`h-2 flex-1 rounded-full transition ${i <= current ? 'bg-marigold' : 'bg-chalk'}`}
        />
      ))}
    </div>
  );
}

import { useEffect, useRef } from 'react';

/** "As soon as you land on a screen, its caption is spoken once." */
export function AutoSpeak({ keyName }: { keyName: string }) {
  const language = useSimple((x) => x.language);
  const mute = useSimple((x) => x.mute);
  const voiced = s(language).v[keyName] ?? '';
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (said.current === keyName) return;
    said.current = keyName;
    speak(voiced, language, { mute });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyName, voiced, mute, language]);
  return null;
}

/** Speaker button + a line label; used on price/floor/persona screens. */
export function SpeakSample({ label, text }: { label: string; text: string }) {
  const language = useSimple((x) => x.language);
  const mute = useSimple((x) => x.mute);
  return (
    <button
      type="button"
      onClick={() => speak(text, language, { mute })}
      className="btn btn-quiet !min-h-11 !text-sm"
    >
      <span aria-hidden="true">🔊</span> {label}
    </button>
  );
}