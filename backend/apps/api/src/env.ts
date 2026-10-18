import { z } from "zod";

/** The development-only signing key. Refused in production (every token would be forgeable). */
export const DEV_JWT_SECRET = "dev-insecure-change-me-in-prod-0123456789";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().default("postgres://moltol:moltol@localhost:5432/moltol"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  CORS_ORIGIN: z.string().default("*"),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),
  /**
   * Which peers may set X-Forwarded-For (the client IP rate limits key on), as
   * proxy-addr names/subnets. The default trusts private networks — Caddy on the
   * compose network — while the API itself is never published. "false" = trust none.
   */
  TRUST_PROXY: z.string().default("loopback,uniquelocal"),
  /** Requests per minute per client IP across the API (auth endpoints are stricter). */
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(300),
  /** Currency new shops price in. The bazaar is Indian; see README for PayPal + INR. */
  DEFAULT_CURRENCY: z
    .string()
    .length(3)
    .transform((c) => c.toUpperCase())
    .default("INR"),

  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_CLIENT_ID: z.string().default(""),
  PAYPAL_CLIENT_SECRET: z.string().default(""),
  PAYPAL_WEBHOOK_ID: z.string().default(""),

  LLM_BASE_URL: z.string().default(""),
  LLM_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().default(""),

  CHANNEL3_API_KEY: z.string().default(""),
  SERPAPI_API_KEY: z.string().default(""),

  /** The currency PayPal is charged in; shops still price in DEFAULT_CURRENCY. */
  PAYPAL_SETTLEMENT_CURRENCY: z
    .string()
    .length(3)
    .transform((c) => c.toUpperCase())
    .default("USD"),
  /** INR → USD (minor units are 1:1 while both have 2 decimals). ~₹83.33 = $1. */
  FX_USD_PER_INR: z.coerce.number().positive().default(0.012),

  SMTP_HOST: z.string().default("smtp-relay.brevo.com"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  EMAIL_FROM: z.string().default("MolTol <no-reply@moltol.app>"),
  JWT_SECRET: z.string().min(16).default(DEV_JWT_SECRET),
  /** Session lifetime, in @fastify/jwt (`ms`) notation. */
  JWT_TTL: z.string().default("7d"),
  /** Production refuses the offline mock checkout (it "pays" without money) unless this is "true". */
  ALLOW_MOCK_PAYMENTS: z.enum(["true", "false"]).default("false"),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parse an environment; returns the problems instead of exiting (testable). */
export function parseEnv(
  source: NodeJS.ProcessEnv,
): { ok: true; env: Env } | { ok: false; errors: Record<string, string[]> } {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  }
  const env = parsed.data;
  if (
    env.NODE_ENV === "production" &&
    (env.JWT_SECRET === DEV_JWT_SECRET || env.JWT_SECRET.length < 32)
  ) {
    return {
      ok: false,
      errors: {
        JWT_SECRET: [
          "must be set to a private value of at least 32 characters in production (openssl rand -hex 32)",
        ],
      },
    };
  }
  if (
    env.NODE_ENV === "production" &&
    !paypalConfigured(env) &&
    env.ALLOW_MOCK_PAYMENTS !== "true"
  ) {
    return {
      ok: false,
      errors: {
        PAYPAL_CLIENT_ID: [
          "PayPal is not configured, so checkout would be the mock gateway; set PayPal keys or ALLOW_MOCK_PAYMENTS=true",
        ],
      },
    };
  }
  return { ok: true, env };
}

export function loadEnv(): Env {
  const result = parseEnv(process.env);
  if (!result.ok) {
    console.error("Invalid environment:", result.errors);
    process.exit(1);
  }
  return result.env;
}

export function paypalConfigured(env: Env): boolean {
  return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
}
