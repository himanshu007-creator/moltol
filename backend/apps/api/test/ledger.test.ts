import { describe, expect, it } from "vitest";
import type { Negotiation } from "@moltol/contracts";
import type { BasketRow } from "@moltol/store";
import {
  computeBuyerInsights,
  computeLedger,
  streakDays,
  toLedgerRow,
  windowFor,
  type LedgerLineInput,
} from "../src/ledger";

const line = (over: Partial<LedgerLineInput> = {}): LedgerLineInput => ({
  negotiationId: "11111111-1111-1111-1111-111111111111",
  basketId: "22222222-2222-2222-2222-222222222222",
  ts: new Date("2026-10-18T10:00:00.000Z"),
  currency: "INR",
  itemId: null,
  name: "Basmati rice",
  emoji: "🌾",
  unit: "kg",
  qty: 2,
  unitCents: 9000,
  listCents: 12000,
  floorCents: 8000,
  fairness: 72,
  verified: true,
  ...over,
});

const basket = (over: Partial<BasketRow> = {}): BasketRow =>
  ({
    id: "22222222-2222-2222-2222-222222222222",
    buyerUserId: "33333333-3333-3333-3333-333333333333",
    shopId: "44444444-4444-4444-4444-444444444444",
    currency: "INR",
    roundsMax: 8,
    tone: "stoic",
    preset: null,
    state: "paid",
    paidAt: new Date("2026-10-18T10:00:00.000Z"),
    createdAt: new Date("2026-10-18T09:00:00.000Z"),
    updatedAt: new Date("2026-10-18T10:00:00.000Z"),
    ...over,
  }) as BasketRow;

const negLine = (id: string, basketId: string, state: string): Negotiation =>
  ({ id, basketId, state }) as unknown as Negotiation;

describe("windowFor", () => {
  it("has an open start for 'all' and a bounded start otherwise", () => {
    const now = Date.UTC(2026, 9, 18);
    expect(windowFor("all", now).from).toBeNull();
    const w = windowFor("7d", now);
    expect(new Date(w.from!).getTime()).toBe(now - 7 * 24 * 60 * 60 * 1000);
  });
});

describe("toLedgerRow", () => {
  it("derives line money and margin in integer cents", () => {
    const row = toLedgerRow(line());
    expect(row.listLineCents).toBe(24000);
    expect(row.lineCents).toBe(18000);
    expect(row.floorLineCents).toBe(16000);
    expect(row.marginCents).toBe(2000);
    expect(row.discountPct).toBe(25);
    expect(row.won).toBe(true);
  });

  it("marks a no-deal line as lost with no margin", () => {
    const row = toLedgerRow(line({ unitCents: null }));
    expect(row.won).toBe(false);
    expect(row.lineCents).toBeNull();
    expect(row.marginCents).toBeNull();
    expect(row.discountPct).toBe(0);
  });
});

describe("computeLedger", () => {
  it("sums KPIs and buckets the widgets", () => {
    const lines = [line(), line({ unitCents: null, name: "Toor dal" })];
    const ledger = computeLedger({
      window: windowFor("30d"),
      currency: "INR",
      lines,
      baskets: [basket()],
      allLines: [negLine("11111111-1111-1111-1111-111111111111", basket().id, "paid")],
    });
    expect(ledger.kpis.deals).toEqual({ total: 2, won: 1, lost: 1, winRatePct: 50 });
    expect(ledger.kpis.revenueCents).toBe(18000);
    expect(ledger.kpis.marginKeptCents).toBe(2000);
    expect(ledger.kpis.unitsSold).toBe(2);
    expect(ledger.widgets.marginByItem[0]?.label).toBe("Basmati rice");
    expect(ledger.widgets.fairnessHistogram.find((b) => b.label === "60–80")?.count).toBe(1);
    expect(ledger.widgets.dealFunnel.find((s) => s.stage === "paid")?.count).toBe(1);
  });
});

describe("streakDays", () => {
  it("counts consecutive days ending today", () => {
    const now = new Date("2026-10-18T12:00:00.000Z");
    expect(
      streakDays([new Date("2026-10-18T08:00:00Z"), new Date("2026-10-17T08:00:00Z")], now),
    ).toBe(2);
    expect(streakDays([], now)).toBe(0);
  });
});

describe("computeBuyerInsights", () => {
  it("totals spend and savings over won lines", () => {
    const rows = [toLedgerRow(line())];
    const insights = computeBuyerInsights({
      currency: "INR",
      orders: [{ ts: new Date("2026-10-18T10:00:00Z"), shopId: "s1", lines: rows }],
    });
    expect(insights.orders).toBe(1);
    expect(insights.totalSpentCents).toBe(18000);
    expect(insights.totalSavedCents).toBe(6000);
    expect(insights.avgSavingsPct).toBe(25);
    expect(insights.cards.some((c) => c.kind === "savings")).toBe(true);
  });
});
