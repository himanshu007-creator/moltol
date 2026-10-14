/** Persona presets drive β and voice (plan.md §7.3). */
export const PERSONAS = {
  charmer: { label: 'The Charmer', beta: 1.4, voice: 'Warm, bundles, flatters' },
  stoic: { label: 'The Stoic', beta: 0.4, voice: 'Terse, firm, cites the market' },
  storyteller: { label: 'The Storyteller', beta: 0.9, voice: 'Anecdotes and relationship' },
  analyst: { label: 'The Analyst', beta: 0.6, voice: 'Cites comps and past deals' },
} as const;

export type PersonaId = keyof typeof PERSONAS;
