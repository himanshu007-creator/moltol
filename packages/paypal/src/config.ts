export type PayPalEnv = "sandbox" | "live";

export interface PayPalConfig {
  env: PayPalEnv;
  clientId: string;
  clientSecret: string;
  /** Override for tests / proxies. */
  baseUrl?: string;
}

export const PAYPAL_BASE_URL: Record<PayPalEnv, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

export function baseUrlFor(config: PayPalConfig): string {
  return config.baseUrl ?? PAYPAL_BASE_URL[config.env];
}
