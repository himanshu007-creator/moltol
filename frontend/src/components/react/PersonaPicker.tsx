import { useState } from 'react';
import { card } from '@/lib/ui';
import { cn } from '@/lib/cn';
import { PERSONAS, type PersonaId } from '@/lib/policy';

const EMOJI: Record<PersonaId, string> = {
  charmer: '😊',
  stoic: '😐',
  storyteller: '🗣️',
  analyst: '🧮',
};

export default function PersonaPicker({ initial = 'charmer' }: { initial?: PersonaId }) {
  const [persona, setPersona] = useState<PersonaId>(initial);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(Object.keys(PERSONAS) as PersonaId[]).map((id) => {
        const p = PERSONAS[id];
        const active = persona === id;
        return (
          <button
            type="button"
            key={id}
            onClick={() => setPersona(id)}
            aria-pressed={active}
            className={cn(
              card,
              'flex flex-col gap-2 p-4 text-left transition',
              active ? 'ring-2 ring-chili' : 'hover:-translate-y-0.5',
            )}
          >
            <span className="text-2xl" aria-hidden="true">
              {EMOJI[id]}
            </span>
            <span className="text-sm font-semibold text-ink">{p.label}</span>
            <span className="text-xs text-ink-faint">{p.voice}</span>
          </button>
        );
      })}
    </div>
  );
}
