import { afterEach, describe, expect, it, vi } from "vitest";
import { channel3Comps } from "../src/channel3";

afterEach(() => {
  vi.unstubAllGlobals();
});

const usdOffer = (price: number) => ({ price: { price, currency: "USD" } });

describe("channel3Comps", () => {
  it("POSTs to /v1/search with the x-api-key header", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ products: [{ offers: [usdOffer(10)] }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await channel3Comps({
      query: "bottle",
      currency: "USD",
      apiKey: "k",
      baseUrl: "https://api.trychannel3.com",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://api.trychannel3.com/v1/search");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(JSON.parse(String(init.body))).toMatchObject({ query: "bottle" });
  });

  it("uses same-currency offers directly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ products: [{ offers: [usdOffer(20)] }, { offers: [usdOffer(30)] }] }),
      })),
    );
    const range = await channel3Comps({
      query: "x",
      currency: "USD",
      apiKey: "k",
      baseUrl: "https://api.trychannel3.com",
    });
    expect(range?.source).toBe("channel3");
    expect(range?.sampleCount).toBe(2);
    expect(range?.medianCents).toBe(2000);
  });

  it("converts USD offers to INR with the configured rate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          products: [{ offers: [usdOffer(12)] }, { offers: [usdOffer(24)] }],
        }),
      })),
    );
    // 0.012 USD per INR: $12 -> 1000 INR -> 100000 cents
    const range = await channel3Comps({
      query: "x",
      currency: "INR",
      apiKey: "k",
      baseUrl: "https://api.trychannel3.com",
      fxUsdPerInr: 0.012,
    });
    expect(range?.medianCents).toBe(100000);
  });

  it("skips offers in unknown currencies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          products: [{ offers: [{ price: { price: 9, currency: "EUR" } }] }],
        }),
      })),
    );
    const range = await channel3Comps({
      query: "x",
      currency: "INR",
      apiKey: "k",
      baseUrl: "https://api.trychannel3.com",
      fxUsdPerInr: 0.012,
    });
    expect(range).toBeNull();
  });

  it("returns null when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    expect(
      await channel3Comps({
        query: "x",
        currency: "USD",
        apiKey: "k",
        baseUrl: "https://api.trychannel3.com",
      }),
    ).toBeNull();
  });
});
