import { describe, expect, it } from "vitest";
import { settleAmount } from "../src/settlement";

const opts = { settlementCurrency: "USD", rates: { INR_USD: 0.012 } };

describe("settleAmount", () => {
  it("converts INR minor units into USD minor units", () => {
    const s = settleAmount(400000, "INR", opts); // ₹4,000.00
    expect(s).toEqual({ amountCents: 4800, currency: "USD", rate: 0.012 }); // $48.00
  });

  it("rounds to the nearest gateway minor unit", () => {
    expect(settleAmount(1234, "INR", opts).amountCents).toBe(15); // 14.808 → 15
  });

  it("passes a same-currency amount through unchanged", () => {
    expect(settleAmount(5000, "USD", opts)).toEqual({
      amountCents: 5000,
      currency: "USD",
      rate: 1,
    });
  });

  it("is case-insensitive on the deal currency", () => {
    expect(settleAmount(1000, "inr", opts).currency).toBe("USD");
  });

  it("leaves an unknown pair untouched for the gateway to reject", () => {
    expect(settleAmount(1000, "EUR", opts)).toEqual({
      amountCents: 1000,
      currency: "EUR",
      rate: 1,
    });
  });
});
