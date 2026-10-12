import { parseEvent, type NegotiationEvent } from './events';
import fixture from '@/fixtures/haggle-01.json';

/**
 * Transport = the ONE seam between the UI and "where events come from".
 * Today: a fixture player (recorded JSON, or the engine's deterministic run).
 * Later: WebSocketTransport, chosen by PUBLIC_USE_FIXTURE=false. Nothing above
 * this file changes (FE_plan §5, §7).
 */

export type StreamStatus = 'connecting' | 'playing' | 'replay' | 'open' | 'closed' | 'error';

export interface FixtureFile {
  negotiationId: string;
  productId: string;
  recordedAt: string;
  events: NegotiationEvent[];
}

export interface StreamHandlers {
  onEvent: (event: NegotiationEvent) => void;
  onStatus?: (status: StreamStatus) => void;
}

export function loadFixture(): FixtureFile {
  return fixture as unknown as FixtureFile;
}

export function useFixture(): boolean {
  return import.meta.env.PUBLIC_USE_FIXTURE !== 'false';
}

/** Per-kind dwell time so the theatre breathes instead of dumping events. */
function dwell(event: NegotiationEvent): number {
  switch (event.t) {
    case 'session.started':
      return 350;
    case 'commit.recorded':
      return 450;
    case 'turn':
      return event.kind === 'accept' ? 700 : 1150;
    case 'deal.agreed':
      return 900;
    case 'payment.status':
      return 750;
    case 'proof.revealed':
      return 1400;
    case 'session.ended':
      return 250;
    default:
      return 600;
  }
}

/**
 * Replay a recorded event list with realistic timing. Same code path as a live
 * socket — the reducer can't tell the difference. Returns a stop() function.
 */
export function playEvents(
  events: readonly NegotiationEvent[],
  handlers: StreamHandlers,
  opts: { speed?: number; replay?: boolean } = {},
): () => void {
  const speed = opts.speed ?? 1;
  handlers.onStatus?.(opts.replay ? 'replay' : 'playing');
  let i = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;

  const step = () => {
    if (stopped) return;
    const event = events[i];
    if (!event) {
      handlers.onStatus?.('closed');
      return;
    }
    handlers.onEvent(event);
    i++;
    if (i < events.length) {
      timer = setTimeout(step, dwell(event) / speed);
    } else {
      handlers.onStatus?.('closed');
    }
  };

  timer = setTimeout(step, 200 / speed);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** Real backend transport (used once PUBLIC_USE_FIXTURE=false). */
export interface SocketTransportOptions {
  url: string;
  /** push extra events from the UI (takeover offers) */
  send?: (data: unknown) => void;
}

export function openSocket(url: string, handlers: StreamHandlers): () => void {
  let closed = false;
  let attempt = 0;
  let ws: WebSocket | null = null;

  handlers.onStatus?.('connecting');

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      attempt = 0;
      handlers.onStatus?.('open');
    };
    ws.onmessage = (ev) => {
      try {
        handlers.onEvent(parseEvent(JSON.parse(ev.data as string)));
      } catch {
        // fail closed: a malformed frame is ignored, never rendered
      }
    };
    ws.onerror = () => handlers.onStatus?.('error');
    ws.onclose = () => {
      if (closed) return;
      handlers.onStatus?.('closed');
      attempt++;
      const backoff = Math.min(1000 * 2 ** attempt, 15000);
      setTimeout(connect, backoff);
    };
  };

  connect();
  return () => {
    closed = true;
    ws?.close();
  };
}
