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

  it("accepts the sandbox simulator sentinel and rejects it in live", async () => {
    expect(
      await verifyWebhookSignature({
        headers: baseHeaders,
        rawBody: "{}",
        webhookId: "WEBHOOK_ID",
        env: "sandbox",
      }),
    ).toBe(true);
    expect(
      await verifyWebhookSignature({
        headers: baseHeaders,
        rawBody: "{}",
        webhookId: "WEBHOOK_ID",
        env: "live",
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
