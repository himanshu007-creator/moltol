import { baseUrlFor, type PayPalConfig } from "./config";

/**
 * Minimal PayPal REST client with a single-flight OAuth token cache. Access
 * tokens live ~9h; we refresh 60s early and never stampede the token endpoint.
 */
export class PayPalClient {
  private token: { value: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(private readonly config: PayPalConfig) {}

  get env(): PayPalConfig["env"] {
    return this.config.env;
  }

  async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchToken().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      "base64",
    );
    const res = await fetch(`${baseUrlFor(this.config)}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      throw new Error(`paypal token request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    };
    return this.token.value;
  }

  /**
   * Authenticated JSON call. `requestId` becomes the idempotency key
   * (`PayPal-Request-Id`) on mutating calls.
   */
  async request<T>(
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; requestId?: string } = {},
  ): Promise<{ ok: boolean; status: number; data: T }> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.requestId) headers["PayPal-Request-Id"] = options.requestId;
    const res = await fetch(`${baseUrlFor(this.config)}${path}`, {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      data: (text ? JSON.parse(text) : {}) as T,
    };
  }

  /** For tests: seed the token cache directly. */
  setTokenForTest(value: string, ttlMs = 3600_000): void {
    this.token = { value, expiresAt: Date.now() + ttlMs };
  }
}
