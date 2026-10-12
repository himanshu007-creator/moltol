/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_USE_FIXTURE?: string;
  readonly PUBLIC_USE_MOCK?: string;
  readonly PUBLIC_SIMPLE_AUDIO?: string;
  readonly PUBLIC_API_BASE?: string;
  readonly PUBLIC_WS_BASE?: string;
  readonly PUBLIC_PAYPAL_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
