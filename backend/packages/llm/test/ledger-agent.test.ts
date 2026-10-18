import { describe, expect, it } from "vitest";
import type { Ledger } from "@moltol/contracts";
import { createLedgerAgent, heuristicAnswer, ledgerFacts } from "../src/ledger-agent";

const ctx = {
  window: {
    period: "30d" as const,
    from: "2026-09-18T00:00:00.000Z",
    to: "2026-10-18T00:00:00.000Z",
  },
  currency: "INR",
  kpis: {
    deals: { total: 4, won: 3, lost: 1, winRatePct: 75 },
    unitsSold: 5,
    revenueCents: 30000,
    listCents: 40000,
    savingsGivenCents: 10000,
    marginKeptCents: 6000,
    avgDiscountPct: 25,
    avgFairness: 70,
    proofVerifiedRatePct: 100,
  },
  widgets: {
    marginByItem: [{ label: "Basmati rice", valueCents: 6000, count: 3 }],
    revenueByItem: [{ label: "Basmati rice", valueCents: 30000, count: 3 }],
    fairnessHistogram: [],
    dealFunnel: [
      { stage: "created" as const, label: "Baskets started", count: 5 },
      { stage: "settled" as const, label: "All lanes closed", count: 4 },
      { stage: "checked_out" as const, label: "Reached checkout", count: 4 },
      { stage: "paid" as const, label: "Paid", count: 4 },
    ],
  },
  rows: [],
} satisfies Ledger;

describe("heuristicAnswer", () => {
  it("answers a margin question from the ledger facts", () => {
    expect(heuristicAnswer(ctx, "How much margin did I keep?")).toContain("₹60");
  });

  it("answers a revenue question and names the top seller", () => {
    const answer = heuristicAnswer(ctx, "What were my sales?");
    expect(answer).toContain("Basmati rice");
  });

  it("answers a funnel question", () => {
    expect(heuristicAnswer(ctx, "Where do buyers drop off?")).toContain("Funnel");
  });
});

describe("createLedgerAgent (offline)", () => {
  it("falls back to the heuristic when no LLM is configured", async () => {
    const agent = createLedgerAgent(ctx, {});
    const result = await agent.ask("win rate?");
    expect(result.source).toBe("heuristic");
    expect(result.answer).toContain("75%");
  });
});

describe("ledgerFacts", () => {
  it("exposes labelled facts including the top item and funnel", () => {
    const labels = ledgerFacts(ctx).map((f) => f.label);
    expect(labels).toContain("margin");
    expect(labels).toContain("top-margin-item");
    expect(labels).toContain("funnel");
  });
});
