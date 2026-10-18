import type { FastifyInstance } from "fastify";
import { SnapRequestSchema } from "@moltol/contracts";
import { createSnapProvider } from "@moltol/llm";
import type { Container } from "./container";
import { invalidBody } from "./http";

/**
 * Snap-to-add. The vendor photographs a product; the backend names it. The image
 * travels inline (a data URL in the body) so no image hosting is required, and the
 * reply is always a short, editable list — never an error when the model is absent.
 */
export async function registerSnapRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  const { env } = container;
  const provider = createSnapProvider({
    baseUrl: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL,
  });

  app.post(
    "/v1/inventory/snap",
    {
      preHandler: [app.authenticate],
      // The inline data URL is larger than the API default body limit.
      bodyLimit: 5_000_000,
    },
    async (req, reply) => {
      const parsed = SnapRequestSchema.safeParse(req.body);
      if (!parsed.success) return invalidBody(reply, parsed.error);
      const result = await provider.detect(parsed.data.image, parsed.data.hint);
      return reply.send(result);
    },
  );
}
