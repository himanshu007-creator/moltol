import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().default("postgres://moltol:moltol@localhost:5432/moltol"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  CORS_ORIGIN: z.string().default("*"),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),

  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_CLIENT_ID: z.string().default(""),
  PAYPAL_CLIENT_SECRET: z.string().default(""),
  PAYPAL_WEBHOOK_ID: z.string().default(""),

  LLM_BASE_URL: z.string().default(""),
  LLM_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().default(""),

  CHANNEL3_API_KEY: z.string().default(""),

  SMTP_HOST: z.string().default("smtp-relay.brevo.com"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  EMAIL_FROM: z.string().default("MolTol <no-reply@moltol.app>"),
  JWT_SECRET: z.string().min(16).default("dev-insecure-change-me-in-prod-0123456789"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export function paypalConfigured(env: Env): boolean {
  return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
}
