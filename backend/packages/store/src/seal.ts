import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Optional at-rest sealing for the sealed-limit vault. When `SEAL_KEY` is a
 * 32-byte hex string, limits are stored as AES-256-GCM `iv|tag|ciphertext` so a
 * database reader (or a backup) cannot see them. The AAD binds the ciphertext to
 * its negotiation and side, so records cannot be swapped between negotiations.
 */

const IV_BYTES = 12;

export function parseSealKey(hex: string | undefined): Buffer | null {
  if (!hex) return null;
  const key = Buffer.from(hex.trim(), "hex");
  return key.length === 32 ? key : null;
}

export function encryptLimit(limitCents: number, aad: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const enc = Buffer.concat([
    cipher.update(Buffer.from(String(limitCents), "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptLimit(blob: string, aad: string, key: Buffer): number {
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + 16);
  const enc = raw.subarray(IV_BYTES + 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  const limit = Number(plain);
  if (!Number.isInteger(limit) || limit < 0) throw new Error("sealed limit corrupt");
  return limit;
}
