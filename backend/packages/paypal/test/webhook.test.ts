import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildSignedMessage,
  computeCrc32,
  extractHeaders,
  isTrustedCertUrl,
  verifyWebhookSignature,
  verifyWithPublicKey,
} from "../src/index";

describe("crc32 (PayPal self-verification)", () => {
  it("matches the standard CRC-32 vector", () => {
    expect(computeCrc32("123456789")).toBe(3421780262);
  });

  it("hashes the raw body bytes, unsigned", () => {
    const crc = computeCrc32('{"a":1}');
    expect(Number.isInteger(crc)).toBe(true);
    expect(crc).toBeGreaterThanOrEqual(0);
  });
});

describe("signed message", () => {
  it("joins transmissionId|timestamp|webhookId|crc32", () => {
    expect(
      buildSignedMessage({ transmissionId: "t", timestamp: "2024", webhookId: "W", crc: 42 }),
    ).toBe("t|2024|W|42");
  });
});

describe("cert url trust", () => {
  it("only trusts https on *.paypal.com", () => {
    expect(isTrustedCertUrl("https://api.paypal.com/v1/certs")).toBe(true);
    expect(isTrustedCertUrl("https://api.sandbox.paypal.com/x")).toBe(true);
    expect(isTrustedCertUrl("http://api.paypal.com/x")).toBe(false);
    expect(isTrustedCertUrl("https://evilpaypal.com/x")).toBe(false);
    expect(isTrustedCertUrl("https://evil.com/api.paypal.com")).toBe(false);
  });
});

describe("RSA verification", () => {
  it("accepts a genuine signature and rejects tampering", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const message = buildSignedMessage({
      transmissionId: "t",
      timestamp: "1",
      webhookId: "W",
      crc: 7,
    });
    const signature = sign("sha256", Buffer.from(message), privateKey);
    expect(
      verifyWithPublicKey(
        message,
        signature.toString("base64"),
        publicKey.export({ type: "spki", format: "pem" }),
      ),
    ).toBe(true);
    expect(
      verifyWithPublicKey(
        `${message}x`,
        signature.toString("base64"),
        publicKey.export({ type: "spki", format: "pem" }),
      ),
    ).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  const baseHeaders = {
    "paypal-transmission-id": "abc",
    "paypal-transmission-time": "2024-01-01T00:00:00Z",
    "paypal-transmission-sig": "sig",
    "paypal-cert-url": "https://api.paypal.com/v1/notifications/certs/CERT",
    "paypal-auth-algo": "SHA256withRSA",
  };

  // Stands in for PayPal's signing key; the "cert" resolves to its public half.
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const resolveKey = async () => publicKey;

  function signed(rawBody: string, webhookId: string) {
    const message = buildSignedMessage({
      transmissionId: baseHeaders["paypal-transmission-id"],
      timestamp: baseHeaders["paypal-transmission-time"],
      webhookId,
      crc: computeCrc32(rawBody),
    });
    return {
      ...baseHeaders,
      "paypal-transmission-sig": sign("sha256", Buffer.from(message), privateKey).toString(
        "base64",
      ),
    };
  }

  const body = '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED"}';

  it("verifies a genuinely signed event", async () => {
    expect(
      await verifyWebhookSignature({
        headers: signed(body, "REAL_ID"),
        rawBody: body,
        webhookId: "REAL_ID",
        env: "live",
        resolveKey,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body or a different webhook id", async () => {
    const headers = signed(body, "REAL_ID");
    const base = { headers, webhookId: "REAL_ID", env: "sandbox" as const, resolveKey };
    expect(await verifyWebhookSignature({ ...base, rawBody: `${body} ` })).toBe(false);
    expect(await verifyWebhookSignature({ ...base, rawBody: body, webhookId: "OTHER" })).toBe(
      false,
    );
  });

  it("checks simulator events cryptographically too (sentinel id WEBHOOK_ID, sandbox only)", async () => {
    const headers = signed(body, "WEBHOOK_ID");
    const base = { headers, rawBody: body, webhookId: "WEBHOOK_ID", resolveKey };
    expect(await verifyWebhookSignature({ ...base, env: "sandbox" })).toBe(true);
    expect(await verifyWebhookSignature({ ...base, env: "live" })).toBe(false);
  });

  it("regression: a forged event with the simulator sentinel is rejected", async () => {
    expect(
      await verifyWebhookSignature({
        headers: baseHeaders, // junk signature
        rawBody: body,
        webhookId: "WEBHOOK_ID",
        env: "sandbox",
        resolveKey,
      }),
    ).toBe(false);
  });

  it("rejects when no webhook id is configured", async () => {
    expect(
      await verifyWebhookSignature({
        headers: signed(body, ""),
        rawBody: body,
        webhookId: "",
        env: "sandbox",
        resolveKey,
      }),
    ).toBe(false);
  });

  it("rejects a webhook whose cert url is not paypal.com", async () => {
    const headers = { ...baseHeaders, "paypal-cert-url": "https://evil.com/cert" };
    expect(
      await verifyWebhookSignature({
        headers,
        rawBody: "{}",
        webhookId: "REAL_ID",
        env: "sandbox",
      }),
    ).toBe(false);
  });

  it("returns false when required headers are missing", async () => {
    expect(
      await verifyWebhookSignature({
        headers: {},
        rawBody: "{}",
        webhookId: "REAL_ID",
        env: "sandbox",
      }),
    ).toBe(false);
    expect(extractHeaders({})).toBeNull();
  });
});
