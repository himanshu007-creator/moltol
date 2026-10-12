import { NEGOTIATION_QUEUE } from "@moltol/config";
import type { NegotiationRunner } from "@moltol/engine";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

/** BullMQ enqueue adapter (the local/worker runner). jobId = negotiation id dedupes. */
export function createQueueRunner(
  redisUrl: string,
): NegotiationRunner & { close: () => Promise<void> } {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(NEGOTIATION_QUEUE, { connection });
  return {
    async enqueue(negotiationId: string) {
      await queue.add(
        "haggle",
        { negotiationId },
        { jobId: negotiationId, removeOnComplete: true },
      );
    },
    async close() {
      await queue.close();
      await connection.quit().catch(() => {});
    },
  };
}
