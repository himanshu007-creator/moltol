import type { NegotiationRunner } from "@moltol/engine";
import { Render } from "@renderinc/sdk";

/** The workflow/task slug from the Render dashboard (workflow-slug/task-name). */
export const HAGGLE_TASK_SLUG = process.env.RENDER_HAGGLE_TASK_SLUG ?? "moltol/haggle";

/**
 * A `NegotiationRunner` backed by Render Workflows. Drop-in replacement for the
 * BullMQ runner: the API can enqueue here when `RUNNER=render`.
 */
export function createRenderRunner(): NegotiationRunner {
  const render = new Render();
  return {
    async enqueue(negotiationId: string): Promise<void> {
      await render.workflows.startTask(HAGGLE_TASK_SLUG, [negotiationId]);
    },
  };
}
