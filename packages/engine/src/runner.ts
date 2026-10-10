/**
 * How a "run this negotiation" instruction is delivered. The worker app provides
 * a Redis/BullMQ adapter; the workflow app provides a Render Workflows adapter.
 * Selected by env, so the engine is agnostic to where it runs.
 */
export interface NegotiationRunner {
  enqueue(negotiationId: string): Promise<void>;
}
