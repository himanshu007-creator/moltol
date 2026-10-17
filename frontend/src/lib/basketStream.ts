import { parseEvent, type NegotiationEvent } from './events';

export type StreamStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface BasketStreamHandlers {
  onEvent: (event: NegotiationEvent) => void;
  onStatus?: (status: StreamStatus) => void;
}

/**
 * One SSE connection for every lane of a basket (`GET /v1/baskets/:id/events`
 * — see `backend/apps/api/src/sse.ts`). Each frame is routed to its lane by
 * `event.negotiationId` (= that lane's `lineItemId`) by the caller's
 * `onEvent`. `EventSource` auto-reconnects using the `retry: 3000` the
 * backend sends and resumes via `Last-Event-ID` on its own — no manual
 * backoff loop needed here.
 */
export function openBasketStream(url: string, handlers: BasketStreamHandlers): () => void {
  handlers.onStatus?.('connecting');
  const source = new EventSource(url);
  source.onopen = () => handlers.onStatus?.('open');
  source.onmessage = (ev) => {
    try {
      handlers.onEvent(parseEvent(JSON.parse(ev.data as string)));
    } catch {
      // fail closed: a malformed frame is ignored, never rendered
    }
  };
  source.onerror = () => handlers.onStatus?.('error');
  return () => {
    source.close();
    handlers.onStatus?.('closed');
  };
}
