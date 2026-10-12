import { describe, expect, it } from "vitest";
import {
  canTransition,
  formatMoney,
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
