import { describe, expect, it } from "vitest";
import {
  canTransition,
  CreateBasketSchema,
  formatCents,
  formatMoney,
  isValidQty,
  isValidStock,
  lineCents,
  NegotiationEventSchema,
  MoneySchema,
  mustTransition,
  STATE_TRANSITIONS,
} from "../src/index";

describe("money", () => {
  it("rejects float cents", () => {
    expect(MoneySchema.safeParse({ amountCents: 35.5 }).success).toBe(false);
    expect(MoneySchema.safeParse({ amountCents: 3500 }).success).toBe(true);
  });

  it("formats USD", () => {
    expect(formatMoney({ amountCents: 3500, currency: "USD" })).toBe("$35.00");
  });
});

describe("state machine", () => {
  it("allows the happy path and blocks illegal jumps", () => {
    expect(canTransition("init", "committed")).toBe(true);
    expect(canTransition("init", "paid")).toBe(false);
    expect(() => mustTransition("init", "paid")).toThrow(/illegal transition/);
  });

  it("treats terminal states as terminal", () => {
    expect(STATE_TRANSITIONS.revealed).toHaveLength(0);
    expect(STATE_TRANSITIONS.no_deal).toHaveLength(0);
  });
});

describe("event envelope", () => {
  it("accepts a well-formed turn event", () => {
    const ok = NegotiationEventSchema.safeParse({
      v: 1,
      id: "00000000-0000-4000-8000-000000000000",
      seq: 3,
      negotiationId: "00000000-0000-4000-8000-000000000001",
      ts: new Date().toISOString(),
      t: "turn",
      turn: { seq: 3, actor: "buyer", kind: "counter", priceCents: 3200, message: "hi" },
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a non-integer price in a turn", () => {
    const bad = NegotiationEventSchema.safeParse({
      v: 1,
      id: "00000000-0000-4000-8000-000000000000",
      seq: 3,
      negotiationId: "00000000-0000-4000-8000-000000000001",
      ts: new Date().toISOString(),
      t: "turn",
      turn: { seq: 3, actor: "buyer", kind: "counter", priceCents: 32.5, message: "hi" },
    });
    expect(bad.success).toBe(false);
  });
});

describe("quantities", () => {
  it("lets mass and volume take up to 3 decimals and keeps counts whole", () => {
    expect(isValidQty(0.25, "kg")).toBe(true);
    expect(isValidQty(0.0005, "kg")).toBe(false);
    expect(isValidQty(1.5, "piece")).toBe(false);
    expect(isValidQty(2, "500g")).toBe(true);
    expect(isValidQty(0, "kg")).toBe(false);
    expect(isValidStock(0, "piece")).toBe(true);
  });

  it("totals a line in integer cents, rounding once", () => {
    expect(lineCents(3350, 0.25)).toBe(838);
    expect(Number.isInteger(lineCents(4123, 1.375))).toBe(true);
  });
});

describe("basket contracts", () => {
  const item = "00000000-0000-4000-8000-000000000010";
  const shopId = "00000000-0000-4000-8000-000000000011";

  it("fills the haggle request with the balanced defaults", () => {
    const parsed = CreateBasketSchema.parse({ shopId, lines: [{ itemId: item, qty: 1 }] });
    expect(parsed.request).toEqual({ rounds: 5, tone: "playful" });
  });

  it("rejects the same item twice in one basket", () => {
    const parsed = CreateBasketSchema.safeParse({
      shopId,
      lines: [
        { itemId: item, qty: 1 },
        { itemId: item, qty: 2 },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a deal without the pre-reveal fairness and a control change", () => {
    const envelope = {
      v: 1,
      id: "00000000-0000-4000-8000-000000000000",
      seq: 9,
      negotiationId: "00000000-0000-4000-8000-000000000001",
      ts: new Date().toISOString(),
    };
    expect(
      NegotiationEventSchema.safeParse({
        ...envelope,
        t: "deal.agreed",
        priceCents: 3500,
        currency: "INR",
      }).success,
    ).toBe(true);
    expect(
      NegotiationEventSchema.safeParse({ ...envelope, t: "control.changed", controller: "human" })
        .success,
    ).toBe(true);
  });

  it("formats prices for wording in the line's currency", () => {
    expect(formatCents(3500, "INR")).toBe("₹35");
    expect(formatCents(3550, "INR")).toBe("₹35.50");
    expect(formatCents(3500, "USD")).toBe("$35.00");
  });
});
