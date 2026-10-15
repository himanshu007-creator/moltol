/** Shared, dependency-free constants used by every app. */

/** BullMQ queue that carries "run this negotiation" jobs. No ":" (BullMQ v5 rule). */
export const NEGOTIATION_QUEUE = "moltol-negotiations";

/** Redis pub/sub channel carrying an event to SSE subscribers. */
export function eventChannel(negotiationId: string): string {
  return `moltol:events:${negotiationId}`;
}

/** Redis pub/sub channel carrying `shop.status` frames to every stall-map client. */
export const SHOP_STATUS_CHANNEL = "moltol:shop-status";

/** Pause between agent turns so a haggle streams at a watchable pace (and can be taken over). */
export const DEFAULT_TURN_DELAY_MS = 900;

/** SSE heartbeat interval (ms) — keeps proxies from closing idle streams. */
export const SSE_HEARTBEAT_MS = 15_000;

/** Default guard band: the LLM may nudge the policy price within ±3%. */
export const DEFAULT_BAND_PCT = 0.03;

/** Round every concrete price to the nearest whole dollar (cents). */
export const PRICE_ROUNDING_CENTS = 100;

/** How long a negotiation may sit without progress before the sweeper fails it. */
export const NEGOTIATION_TIMEOUT_MS = 5 * 60 * 1000;

/** Additional authenticated data binding sealed limits to their negotiation. */
export function sealAad(negotiationId: string, side: string): string {
  return `moltol:v1:seal:${negotiationId}:${side}`;
}
