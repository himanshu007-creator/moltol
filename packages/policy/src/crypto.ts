import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils";
import type { Side } from "@moltol/contracts";

/**
 * Isomorphic SHA-256 + helpers. Uses `@noble/hashes` (pure JS) so the exact same
 * commitment code runs in the browser, letting the frontend verify Proof of Fair
 * Deal locally without trusting the server.
 */

export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? utf8ToBytes(input) : input;
  return bytesToHex(sha256(bytes));
}

export function newSalt(bytes = 16): Uint8Array {
  return randomBytes(bytes);
}

export const toHex = bytesToHex;
export const fromHex = hexToBytes;

/** Canonical string a commitment binds to. Context prevents cross-deal replay. */
export function commitmentPayload(input: {
  negotiationId: string;
  side: Side;
  currency: string;
  limitCents: number;
}): string {
  return `moltol:v1|${input.negotiationId}|${input.side}|${input.currency.toUpperCase()}|${input.limitCents}`;
}

/** H(context || salt). Deterministic; safe to publish before the reveal. */
export function commit(
  input: {
    negotiationId: string;
    side: Side;
    currency: string;
    limitCents: number;
  },
  salt: Uint8Array,
): string {
  return sha256Hex(concatBytes(utf8ToBytes(commitmentPayload(input)), salt));
}

/** Verify a reveal against a previously published commitment (constant-time-ish). */
export function verifyReveal(
  commitment: string,
  input: {
    negotiationId: string;
    side: Side;
    currency: string;
    limitCents: number;
  },
  salt: Uint8Array,
): boolean {
  const recomputed = commit(input, salt);
  if (recomputed.length !== commitment.length) return false;
  let diff = 0;
  for (let i = 0; i < recomputed.length; i++) {
    diff |= recomputed.charCodeAt(i) ^ commitment.charCodeAt(i);
  }
  return diff === 0;
}
