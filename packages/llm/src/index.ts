import type { TurnGenerator } from "@moltol/engine";
import { cannedTurnGenerator } from "./fallback";
import { createLlmTurnGenerator, type LlmConfig } from "./provider";

export * from "./fallback";
export * from "./provider";

/** Use the configured provider when present, otherwise the offline narrator. */
export function createTurnGenerator(config: Partial<LlmConfig> = {}): TurnGenerator {
  if (config.baseUrl && config.apiKey && config.model) {
    return createLlmTurnGenerator({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    });
  }
  return cannedTurnGenerator;
}
