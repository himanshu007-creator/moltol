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
 * Simulated webhooks from the dashboard cannot be verified via the postback
 * endpoint; they "self-verify" and are only trusted when the webhook id is the
 * literal sentinel `WEBHOOK_ID` and we are in sandbox.
 */

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
  webhookId: string;
  env: "sandbox" | "live";
  /** Injectable for tests; defaults to fetching and caching the PayPal cert. */
  fetchCert?: (certUrl: string) => Promise<string>;
}

const certCache = new Map<string, { pem: string; expiresAt: number }>();

async function defaultFetchCert(certUrl: string): Promise<string> {
  const cached = certCache.get(certUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.pem;
  const res = await fetch(certUrl);
  if (!res.ok) throw new Error(`cert fetch failed: ${res.status}`);
  const pem = await res.text();
  certCache.set(certUrl, { pem, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
  return pem;
}

export async function verifyWebhookSignature(options: VerifyOptions): Promise<boolean> {
  const headers = extractHeaders(options.headers);
  if (!headers) return false;

  const isSimulated = options.webhookId === "WEBHOOK_ID";
  if (isSimulated) {
    // Simulator events have no verifiable cert; accept only in sandbox.
    return options.env === "sandbox";
  }

  if (!isTrustedCertUrl(headers.certUrl)) return false;

  const crc = computeCrc32(options.rawBody);
  const message = buildSignedMessage({
    transmissionId: headers.transmissionId,
    timestamp: headers.timestamp,
    webhookId: options.webhookId,
    crc,
  });

  try {
    const pem = await (options.fetchCert ?? defaultFetchCert)(headers.certUrl);
    const cert = new X509Certificate(pem);
    return verifyWithPublicKey(message, headers.signature, cert.publicKey);
  } catch {
    return false;
  }
}
