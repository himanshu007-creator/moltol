import type { MarketRange } from "@moltol/contracts";
import type { MarketProvider } from "@moltol/engine";
import { channel3Comps } from "./channel3";
import { seededComps } from "./fallback";

export * from "./fallback";
export * from "./channel3";

export interface MarketConfig {
  channel3ApiKey?: string | undefined;
  channel3BaseUrl?: string | undefined;
  timeoutMs?: number | undefined;
}

/** Build the market provider used by the engine: Channel3 when configured, else seed. */
export function createMarketProvider(config: MarketConfig = {}): MarketProvider {
  return {
    async getComps(query, currency, hint): Promise<MarketRange> {
      if (config.channel3ApiKey) {
        const live = await channel3Comps({
          query,
          currency,
          apiKey: config.channel3ApiKey,
          baseUrl: config.channel3BaseUrl ?? "https://api.channel3.com",
          ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
        });
        if (live) return live;
      }
      return seededComps(query, currency, hint?.referenceCents);
    },
  };
}
