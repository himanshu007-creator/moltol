import type { OutgoingHttpHeaders } from "node:http";
import { dealChannel, eventChannel, SHOP_STATUS_CHANNEL, SSE_HEARTBEAT_MS } from "@moltol/config";
import type { NegotiationEvent } from "@moltol/contracts";
import type { MoltolStore } from "@moltol/store";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "./redis";

/**
 * Server-sent events. A hijacked reply bypasses Fastify's own header writing,
 * so the headers it had already collected (CORS!) are copied over explicitly —
 * without them a cross-origin EventSource is refused by the browser.
 */
function openSse(reply: FastifyReply): void {
  const pending: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) pending[name] = value;
  }
  reply.hijack();
  reply.raw.writeHead(200, {
    ...pending,
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  reply.raw.write("retry: 3000\n\n");
}

/** Heartbeats + teardown. The response's "close" is the reliable disconnect signal. */
function keepAlive(reply: FastifyReply, onClose: () => void): () => boolean {
  let closed = false;
  const heartbeat = setInterval(() => {
    if (!closed) reply.raw.write(": heartbeat\n\n");
  }, SSE_HEARTBEAT_MS);
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    onClose();
  };
  reply.raw.on("close", close);
  reply.raw.on("error", close);
  return () => closed;
}

export interface StreamSource {
  negotiationId: string;
  /** Resume after this seq (-1 = from the start). */
  afterSeq: number;
}

/**
 * Stream one or more negotiations' public events: backfill from the log, then
 * tail Redis. Live events that arrive during the backfill are buffered and
 * replayed after it, so nothing slips between the two. Anything below a
 * published seq is already committed, so a gap (out-of-order publishes from
 * two writers) is filled from the log instead of being dropped. Each frame's
 * `id:` is `cursorOf(lastSeqs)`, which a reconnecting EventSource sends back as
 * Last-Event-ID.
 */
export async function streamNegotiations(
  _req: FastifyRequest,
  reply: FastifyReply,
  deps: { redis: Redis; store: MoltolStore },
  sources: StreamSource[],
  cursorOf: (lastSeqs: readonly number[]) => string,
): Promise<void> {
  const index = new Map(sources.map((s, i) => [s.negotiationId, i] as const));
  const lastSeq = sources.map((s) => s.afterSeq);
  const subscriber = deps.redis.duplicate();
  let backfilling = true;
  const buffered: NegotiationEvent[] = [];
  let chain: Promise<void> = Promise.resolve();

  const isClosed = keepAlive(reply, () => {
    subscriber.removeAllListeners("message");
    void subscriber.quit().catch(() => {});
  });

  const emit = (i: number, event: NegotiationEvent) => {
    if (isClosed() || event.seq <= lastSeq[i]!) return;
    lastSeq[i] = event.seq;
    if (event.audience !== "all") return; // side-only events never reach the public stream
    reply.raw.write(`id: ${cursorOf(lastSeq)}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  const handle = async (event: NegotiationEvent) => {
    const i = index.get(event.negotiationId);
    if (i === undefined || event.seq <= lastSeq[i]!) return;
    if (event.seq === lastSeq[i]! + 1) return emit(i, event);
    for (const missed of await deps.store.listEvents(event.negotiationId, lastSeq[i])) {
      emit(i, missed);
    }
  };
  const enqueue = (event: NegotiationEvent) => {
    chain = chain.then(() => handle(event)).catch(() => {});
  };

  subscriber.on("message", (_channel: string, message: string) => {
    let event: NegotiationEvent;
    try {
      event = JSON.parse(message) as NegotiationEvent;
    } catch {
      return;
    }
    if (backfilling) buffered.push(event);
    else enqueue(event);
  });
  await subscriber.subscribe(...sources.map((s) => eventChannel(s.negotiationId)));

  openSse(reply);
  try {
    for (const [i, source] of sources.entries()) {
      for (const event of await deps.store.listEvents(source.negotiationId, lastSeq[i])) {
        emit(i, event);
      }
    }
  } catch {
    reply.raw.end();
    return;
  }
  backfilling = false;
  for (const event of buffered.splice(0)) enqueue(event);
}

/** Parse a resume cursor: Last-Event-ID wins over `?after` (an EventSource reconnect sends it). */
export function resumeSeqs(
  req: FastifyRequest<{ Querystring: { after?: string } }>,
  count: number,
): number[] {
  const header = req.headers["last-event-id"];
  const raw = (Array.isArray(header) ? header[0] : header) ?? req.query.after;
  const parts = raw === undefined ? [] : String(raw).split(".");
  const seqs = parts.map((p) => Number.parseInt(p, 10));
  if (seqs.length !== count || seqs.some((s) => !Number.isFinite(s) || s < -1)) {
    return new Array<number>(count).fill(-1);
  }
  return seqs;
}

/**
 * A single shop's private deal feed (seller-only). The connection is authorized
 * by a short-lived ticket in the query string, since an EventSource cannot send
 * an Authorization header; the caller verifies the ticket before calling this.
 */
export async function streamShopDeals(
  _req: FastifyRequest,
  reply: FastifyReply,
  redis: Redis,
  shopId: string,
): Promise<void> {
  const subscriber = redis.duplicate();
  const isClosed = keepAlive(reply, () => {
    subscriber.removeAllListeners("message");
    void subscriber.quit().catch(() => {});
  });
  subscriber.on("message", (_channel: string, message: string) => {
    if (!isClosed()) reply.raw.write(`data: ${message}\n\n`);
  });
  await subscriber.subscribe(dealChannel(shopId));
  openSse(reply);
}

/** `shop.status` fan-out: every open/close change, to every stall-map client. */
export async function streamShopStatus(
  _req: FastifyRequest,
  reply: FastifyReply,
  redis: Redis,
): Promise<void> {
  const subscriber = redis.duplicate();
  const isClosed = keepAlive(reply, () => {
    subscriber.removeAllListeners("message");
    void subscriber.quit().catch(() => {});
  });
  subscriber.on("message", (_channel: string, message: string) => {
    if (!isClosed()) reply.raw.write(`data: ${message}\n\n`);
  });
  await subscriber.subscribe(SHOP_STATUS_CHANNEL);
  openSse(reply);
}
