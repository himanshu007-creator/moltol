import { afterEach, describe, expect, it, vi } from "vitest";
import { createSnapProvider } from "../src/vision";

const DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSnapProvider (catalogue fallback)", () => {
  it("matches a hint against the built-in catalogue", async () => {
    const provider = createSnapProvider();
    const result = await provider.detect(DATA_URL, "tomatoes");
    expect(result.source).toBe("catalogue");
    expect(result.suggestions[0]?.name).toBe("Tomatoes");
    expect(result.suggestions[0]?.sellCents).toBeGreaterThan(0);
  });

  it("matches an alias (tamatar)", async () => {
    const provider = createSnapProvider();
    const result = await provider.detect(DATA_URL, "tamatar");
    expect(result.suggestions[0]?.name).toBe("Tomatoes");
  });

  it("returns an empty list without a hint", async () => {
    const provider = createSnapProvider();
    const result = await provider.detect(DATA_URL);
    expect(result).toEqual({ source: "catalogue", suggestions: [] });
  });
});

describe("createSnapProvider (vision)", () => {
  it("uses the model's items and catalogues the pricing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [{ name: "tomato", emoji: "🍅", unit: "kg", confidence: 88 }],
                }),
              },
            },
          ],
        }),
      })),
    );
    const provider = createSnapProvider({ baseUrl: "https://x", apiKey: "k", model: "m" });
    const result = await provider.detect(DATA_URL, "tomato");
    expect(result.source).toBe("vision");
    expect(result.suggestions[0]).toMatchObject({
      name: "Tomatoes",
      unit: "kg",
      confidence: 88,
    });
    expect(result.suggestions[0]?.sellCents).toBeGreaterThan(0);
  });

  it("falls back to the catalogue when the model fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const provider = createSnapProvider({ baseUrl: "https://x", apiKey: "k", model: "m" });
    const result = await provider.detect(DATA_URL, "onions");
    expect(result.source).toBe("catalogue");
    expect(result.suggestions[0]?.name).toBe("Onions");
  });
});
