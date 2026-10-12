/**
 * Buyer haggle personality. Each preset maps to the request sent with a
 * negotiation: rounds (patience), tone, and whether bundles are on the table.
 * The time and savings numbers are mock estimates, labelled as such in the UI.
 */
export type PresetId = 'quick' | 'balanced' | 'hard';

export interface Preset {
  id: PresetId;
  label: string;
  blurb: string;
  /** max rounds per item */
  rounds: number;
  tone: 'polite' | 'playful' | 'firm';
  bundle: boolean;
  /** mock estimates */
  estSeconds: number;
  estSavePct: number;
}

export const PRESETS: Record<PresetId, Preset> = {
  quick: { id: 'quick', label: 'Quick Deal', blurb: 'Fast, close to fair, few rounds', rounds: 3, tone: 'polite', bundle: true, estSeconds: 10, estSavePct: 3 },
  balanced: { id: 'balanced', label: 'Balanced', blurb: 'A fair middle', rounds: 5, tone: 'playful', bundle: true, estSeconds: 25, estSavePct: 7 },
  hard: { id: 'hard', label: 'Hard Bargain', blurb: 'Slower, firmer, lower price', rounds: 8, tone: 'firm', bundle: false, estSeconds: 40, estSavePct: 11 },
};

export const PRESET_ORDER: PresetId[] = ['quick', 'balanced', 'hard'];

/** Slider position (0..2) to preset. */
export function presetAt(pos: number): PresetId {
  return PRESET_ORDER[Math.min(2, Math.max(0, Math.round(pos)))]!;
}

/** The body sent with a negotiation start. */
export interface NegotiationRequest {
  preset: PresetId;
  rounds: number;
  tone: Preset['tone'];
  bundle: boolean;
}

export function requestFor(id: PresetId): NegotiationRequest {
  const p = PRESETS[id];
  return { preset: p.id, rounds: p.rounds, tone: p.tone, bundle: p.bundle };
}
