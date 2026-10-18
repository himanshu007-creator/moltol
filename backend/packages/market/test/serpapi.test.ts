import { afterEach, describe, expect, it, vi } from "vitest";
import { serpapiComps } from "../src/serpapi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("serpapiComps", () => {
  it("reduces shopping results to a market range", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          shopping_results: [
            { extracted_price: 40 },
            { extracted_price: 30 },
            { extracted_price: 50 },
            { extracted_price: 60 },
          ],
        }),
      })),
    );
    const range = await serpapiComps({ query: "tomatoes", currency: "INR", apiKey: "k" });
    expect(range?.source).toBe("serpapi");
    expect(range?.sampleCount).toBe(4);
    expect(range?.medianCents).toBe(4000);
    expect(range?.p25Cents).toBe(3000);
    expect(range?.p75Cents).toBe(5000);
  });

  it("parses string prices when extracted_price is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          shopping_results: [{ price: "$1.99" }, { price: "$3.49" }],
        }),
      })),
    );
    const range = await serpapiComps({ query: "milk", currency: "USD", apiKey: "k" });
    expect(range?.sampleCount).toBe(2);
    expect(range?.medianCents).toBe(199);
  });

  it("returns null when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    expect(await serpapiComps({ query: "x", currency: "USD", apiKey: "k" })).toBeNull();
  });
});
