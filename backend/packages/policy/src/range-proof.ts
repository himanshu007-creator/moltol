import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import type { Side } from "@moltol/contracts";

/**
 * Zero-knowledge *threshold* proof over a hash chain.
 *
 * A side can prove "my sealed limit is at least/at most P" without revealing the
 * limit, given a **public** domain boundary:
 *
 *   shop floor  : prove  floor <= P   with domainMax = list price (public)
 *   buyer  max  : prove  max   >= P   with domainMin = 0 (public)
 *
 * Construction (shop case, `greater` = floor is at least the threshold is the
 * equivalent framing). Let d = domain, secret = floor, n = d - floor (>= 0).
 *   commitment   C = H^{n+1}(seed)
 *   to prove n >= k (i.e. floor <= d - k = P):
 *     proof = H^{n-k+1}(seed)
 *     verifier checks H^k(proof) == C
 * Because the prover fixed C before the pool of candidates existed, they cannot
 * later produce a proof for any k > n. Runs on @noble/hashes so the browser can
 * verify it too.
 */

function walk(seed: Uint8Array, steps: number, context: string): Uint8Array {
  let out = concatBytes(utf8ToBytes(context), seed);
  for (let i = 0; i < steps; i++) out = sha256(out);
  return out;
}

export interface ThresholdCommitInput {
  negotiationId: string;
  side: Side;
  /** Public domain boundary: list price for a shop, 0 for a buyer. */
  domainCents: number;
  /** The private secret (might be a floor or a max). */
  secretCents: number;
}

function contextOf(input: ThresholdCommitInput): string {
  return `moltol:v1:range|${input.negotiationId}|${input.side}|${input.domainCents}`;
}

/** Seal `secretCents` against a public domain. Publish the returned commitment. */
export function thresholdCommit(input: ThresholdCommitInput, seed: Uint8Array): string {
  const n = input.domainCents - input.secretCents;
  if (n < 0) throw new Error("secret lies outside the public domain");
  return bytesToHex(walk(seed, n + 1, contextOf(input)));
}

/**
 * Prove that `secretCents` satisfies the threshold implied by `claimedCents`.
 * For a shop claim ("floor <= P") pass `claimedCents = P`; the returned proof and
 * the caller-published commitment are checked by `thresholdVerify`.
 */
export function thresholdProve(
  input: ThresholdCommitInput,
  claimedCents: number,
  seed: Uint8Array,
): string {
  const n = input.domainCents - input.secretCents;
  const k = input.domainCents - claimedCents;
  if (k < 0 || k > n) throw new Error("threshold not satisfiable for this secret");
  return bytesToHex(walk(seed, n - k + 1, contextOf(input)));
}

export function thresholdVerify(params: {
  negotiationId: string;
  side: Side;
  domainCents: number;
  claimedCents: number;
  commitment: string;
  proof: string;
}): boolean {
  const k = params.domainCents - params.claimedCents;
  if (k < 0) return false;
  let out = hexToBytes(params.proof);
  for (let i = 0; i < k; i++) out = sha256(out);
  return bytesToHex(out) === params.commitment.toLowerCase();
}
