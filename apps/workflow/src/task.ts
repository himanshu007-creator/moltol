import { runHaggle } from "@moltol/engine";
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { getContext } from "./context";

/**
 * The single Render Workflow task. The API enqueues a run with the negotiation
 * id; the run reconstructs state from the append-only event log, so retries are
 * safe (each append is guarded by `nextSeq`).
 */
export const haggle = task(
  { name: "haggle", timeoutSeconds: 300, plan: "flex" },
  async function haggle(ctx: TaskContext, negotiationId: string) {
    void ctx;
    const { store, market, llm, publish } = getContext();
    return runHaggle(negotiationId, {
      store,
      llm,
      market,
      onEvent: publish,
      log: (fields) => console.log(JSON.stringify({ level: "info", ...fields })),
    });
  },
);
