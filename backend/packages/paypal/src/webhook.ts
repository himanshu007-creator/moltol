import { verify as cryptoVerify, X509Certificate, type KeyLike } from "node:crypto";
import { crc32 } from "node:zlib";

/**
 * PayPal webhook self-verification, per developer.paypal.com/api/rest/webhooks.
 *
 *   message = `${transmissionId}|${timestamp}|${webhookId}|${crc32}`
 *   crc32   = unsigned decimal CRC-32 of the RAW request body
 *   signature is an RSA-SHA256 signature over `message`, verified with the
 *   public key from the PayPal certificate at `paypal-cert-url`
 *   (host MUST be *.paypal.com).
 *
 * Webhook-simulator ("mock") events can't use the postback verify endpoint, but
 * they ARE signed: PayPal documents that "for message signature verification
 * purposes, the ID of mock webhooks is the string WEBHOOK_ID". So they go
 * through the same RSA check with that literal id — never a free pass — and
 * only in sandbox. An earlier version returned `true` for the sentinel without
 * checking anything, which let anyone POST a fake PAYMENT.CAPTURE.COMPLETED.
 */

/** The webhook id PayPal signs simulator events with. */
export const SIMULATOR_WEBHOOK_ID = "WEBHOOK_ID";

export interface WebhookHeaders {
  transmissionId: string;
  timestamp: string;
  signature: string;
  certUrl: string;
  authAlgo: string;
}

export function extractHeaders(
  headers: Record<string, string | string[] | undefined>,
): WebhookHeaders | null {
  const get = (k: string): string | undefined => {
    const v = headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const transmissionId = get("paypal-transmission-id");
  const timestamp = get("paypal-transmission-time");
  const signature = get("paypal-transmission-sig");
  const certUrl = get("paypal-cert-url");
  const authAlgo = get("paypal-auth-algo");
  if (!transmissionId || !timestamp || !signature || !certUrl || !authAlgo) return null;
  return { transmissionId, timestamp, signature, certUrl, authAlgo };
}

export function computeCrc32(rawBody: string | Buffer): number {
  return crc32(typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody) >>> 0;
}

export function buildSignedMessage(params: {
  transmissionId: string;
  timestamp: string;
  webhookId: string;
  crc: number;
}): string {
  return `${params.transmissionId}|${params.timestamp}|${params.webhookId}|${params.crc}`;
}

/** The certificate must come from a paypal.com host over https. */
export function isTrustedCertUrl(certUrl: string): boolean {
  try {
    const url = new URL(certUrl);
    return url.protocol === "https:" && /(^|\.)paypal\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export function verifyWithPublicKey(
  message: string,
  signatureB64: string,
  publicKey: KeyLike,
): boolean {
  try {
    return cryptoVerify(
      "sha256",
      Buffer.from(message, "utf8"),
      publicKey,
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}

export interface VerifyOptions {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string | Buffer;
  /** The listener's webhook id, or SIMULATOR_WEBHOOK_ID for simulator events (sandbox only). */
  webhookId: string;
  env: "sandbox" | "live";
  /** Injectable for tests; defaults to fetching (and caching) PayPal's cert and taking its key. */
  resolveKey?: (certUrl: string) => Promise<KeyLike>;
}

const certCache = new Map<string, { key: KeyLike; expiresAt: number }>();

async function defaultResolveKey(certUrl: string): Promise<KeyLike> {
  const cached = certCache.get(certUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.key;
  // No redirects: an open redirect on a paypal.com host must not hand us someone else's cert.
  const res = await fetch(certUrl, { redirect: "error" });
  if (!res.ok) throw new Error(`cert fetch failed: ${res.status}`);
  const key = new X509Certificate(await res.text()).publicKey;
  certCache.set(certUrl, { key, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
  return key;
}

export async function verifyWebhookSignature(options: VerifyOptions): Promise<boolean> {
  const headers = extractHeaders(options.headers);
  if (!headers) return false;
  if (!options.webhookId) return false;
  if (options.webhookId === SIMULATOR_WEBHOOK_ID && options.env !== "sandbox") return false;
  if (!isTrustedCertUrl(headers.certUrl)) return false;

  const message = buildSignedMessage({
    transmissionId: headers.transmissionId,
    timestamp: headers.timestamp,
    webhookId: options.webhookId,
    crc: computeCrc32(options.rawBody),
  });

  try {
    const key = await (options.resolveKey ?? defaultResolveKey)(headers.certUrl);
    return verifyWithPublicKey(message, headers.signature, key);
  } catch {
    return false;
  }
}
