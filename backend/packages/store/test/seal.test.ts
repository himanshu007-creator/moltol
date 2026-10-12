import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptLimit, encryptLimit, parseSealKey } from "../src/seal";

const key = randomBytes(32);
const aad = "moltol:v1:seal:neg-1:buyer";

describe("sealed-limit at-rest encryption", () => {
  it("round-trips a limit with the right key + aad", () => {
    const blob = encryptLimit(12_345, aad, key);
    expect(blob).not.toContain("12345");
    expect(decryptLimit(blob, aad, key)).toBe(12_345);
  });

  it("rejects a swapped aad (record cannot move between negotiations)", () => {
    const blob = encryptLimit(12_345, aad, key);
    expect(() => decryptLimit(blob, "moltol:v1:seal:neg-2:buyer", key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const blob = encryptLimit(12_345, aad, key);
    expect(() => decryptLimit(blob, aad, randomBytes(32))).toThrow();
  });

  it("parses only 32-byte hex keys", () => {
    expect(parseSealKey(undefined)).toBeNull();
    expect(parseSealKey("short")).toBeNull();
    expect(parseSealKey(randomBytes(32).toString("hex"))).toHaveLength(32);
  });
});
