import type { MarketRange } from "@moltol/contracts";
import type { MarketProvider } from "@moltol/engine";
import { channel3Comps } from "./channel3";
import { seededComps } from "./fallback";
import { serpapiComps } from "./serpapi";

export * from "./fallback";
export * from "./channel3";
export * from "./serpapi";

export interface MarketConfig {
  channel3ApiKey?: string | undefined;
  channel3BaseUrl?: string | undefined;
  serpapiApiKey?: string | undefined;
  fxUsdPerInr?: number | undefined;
  timeoutMs?: number | undefined;
}

/**
 * Build the market provider used by the engine. Live providers are tried in order
 * (Channel3, then SerpAPI); the first to return a range wins, else seeded comps.
 */
export function createMarketProvider(config: MarketConfig = {}): MarketProvider {
  const timeout = config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {};
  return {
    async getComps(query, currency, hint): Promise<MarketRange> {
      if (config.channel3ApiKey) {
        const live = await channel3Comps({
          query,
          currency,
          apiKey: config.channel3ApiKey,
          baseUrl: config.channel3BaseUrl ?? "https://api.trychannel3.com",
          ...(config.fxUsdPerInr !== undefined ? { fxUsdPerInr: config.fxUsdPerInr } : {}),
          ...timeout,
        });
        if (live) return live;
      }
      if (config.serpapiApiKey) {
        const live = await serpapiComps({
          query,
          currency,
          apiKey: config.serpapiApiKey,
          ...timeout,
        });
        if (live) return live;
      }
      return seededComps(query, currency, hint?.referenceCents);
    },
  };
}
