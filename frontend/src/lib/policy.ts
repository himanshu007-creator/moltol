import type { Cents } from './money';
import type { Side } from './events';

/**
 * The deterministic policy core — "the LLM proposes, policy disposes" (plan.md §7.5).
 * Everything here is pure (except SHA-256, which is crypto.subtle) so it can be unit
 * tested and, crucially, so the UI can verify a reveal without trusting the backend.
 */

/** Time-dependent (Boulware/Conceder) concession curve. β<1 holds late, β>1 concedes early. */
export function concession(
  t: number,
  T: number,
  beta: number,
  start: Cents,
  limit: Cents,
): Cents {
  const clampedT = Math.min(Math.max(t, 0), T);
  const frac = T === 0 ? 1 : Math.pow(clampedT / T, 1 / beta);
  return Math.round(start + (limit - start) * frac);
}

/** Buyer raises toward its max; shop lowers toward its floor. */
export function nextOffer(
  _side: Side,
  t: number,
  T: number,
  beta: number,
  opening: Cents,
  limit: Cents,
): Cents {
  return concession(t, T, beta, opening, limit);
}

/** Shop accepts when the buyer clears the shop's next ask; buyer, mirror image. */
export function shouldAccept(
  side: Side,
  incoming: Cents,
  nextOwnOffer: Cents,
  limit: Cents,
): boolean {
  return side === 'shop' ? incoming >= nextOwnOffer && incoming >= limit : incoming <= nextOwnOffer && incoming <= limit;
}

/** Share of surplus to the buyer, mapped to 0–100 where 100 is an even split. */
export function fairnessScore(price: Cents, floor: Cents, max: Cents): number {
  if (max <= floor) return 100;
  const shareToBuyer = (price - floor) / (max - floor);
  const evenness = 1 - Math.abs(2 * shareToBuyer - 1);
  return Math.round(evenness * 100);
}

export function zopaExists(floor: Cents, max: Cents): boolean {
  return floor <= max;
}

const enc = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** H(limit ‖ salt) — SHA-256 hex. Same input on both sides ⇒ verifiable reveal. */
export async function commitment(limitCents: Cents, saltHex: string): Promise<string> {
  const data = enc.encode(`moltol.v1|${limitCents}|${saltHex}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

/** Anyone can check a revealed limit against the commitment made at the start. */
export async function verifyReveal(
  commit: string,
  limitCents: Cents,
  saltHex: string,
): Promise<boolean> {
  return (await commitment(limitCents, saltHex)) === commit;
}

export function randomSaltHex(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

/** Persona presets drive β and voice (plan.md §7.3). */
export const PERSONAS = {
  charmer: { label: 'The Charmer', beta: 1.4, voice: 'Warm, bundles, flatters' },
  stoic: { label: 'The Stoic', beta: 0.4, voice: 'Terse, firm, cites the market' },
  storyteller: { label: 'The Storyteller', beta: 0.9, voice: 'Anecdotes and relationship' },
  analyst: { label: 'The Analyst', beta: 0.6, voice: 'Cites comps and past deals' },
} as const;

export type PersonaId = keyof typeof PERSONAS;
