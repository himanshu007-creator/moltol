import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  EventInput,
  MarketRange,
  Negotiation,
  NegotiationEvent,
  NegotiationState,
  Side,
  Turn,
} from "@moltol/contracts";
import type { SealedRecord } from "@moltol/store";
import { runHaggle, type EngineStore, type TurnGenerator } from "../src/index";

class FakeStore implements EngineStore {
  negotiation: Negotiation;
  events: NegotiationEvent[] = [];
  sealed = new Map<string, SealedRecord>();

  constructor(maxTotalCents: number) {
    this.negotiation = {
      id: randomUUID(),
      state: "init",
      query: "widget",
      persona: "analyst",
      roundsMax: 8,
      maxTotalCents,
      currency: "USD",
      agreedPriceCents: null,
      paypalOrderId: null,
      paypalCaptureId: null,
      market: null,
      turns: [],
      createdAt: new Date().toISOString(),
    };
  }

  async getNegotiation(id: string) {
    return id === this.negotiation.id ? this.negotiation : null;
  }
  async nextSeq() {
    return this.events.length;
  }
  async appendEvent(event: NegotiationEvent) {
    if (this.events.some((e) => e.seq === event.seq)) return;
    this.events.push(event);
  }
  makeEvent(negotiationId: string, seq: number, body: EventInput): NegotiationEvent {
    return {
      v: 1,
      id: randomUUID(),
      seq,
      negotiationId,
      ts: new Date().toISOString(),
      audience: "all",
      ...body,
    } as NegotiationEvent;
  }
  async putSealed(record: SealedRecord) {
    this.sealed.set(record.side, record);
  }
  async getSealed(_id: string, side: Side) {
    return this.sealed.get(side) ?? null;
  }
  async transition(_id: string, _from: NegotiationState, to: NegotiationState) {
    this.negotiation.state = to;
    return true;
  }
  async setAgreed(_id: string, price: number, market: MarketRange | null, turns: Turn[]) {
    this.negotiation.agreedPriceCents = price;
    this.negotiation.market = market;
    this.negotiation.turns = turns;
  }
  async setTurns(_id: string, turns: Turn[]) {
    this.negotiation.turns = turns;
  }
}

const market: MarketRange = {
  medianCents: 3600,
  p25Cents: 3000,
  p75Cents: 4200,
  sampleCount: 20,
  source: "test",
};

const marketProvider = { getComps: async () => market };

/** A greedy narrator: turn 0 proposes well outside the band (to exercise the guard). */
const greedyLlm: TurnGenerator = {
  async generate(ctx) {
    if (ctx.actor === "buyer" && ctx.round === 0) {
      return {
        priceCents: Math.round(ctx.policyPriceCents * 0.7),
        message: "lowball",
        tactic: "anchor",
      };
    }
    return { priceCents: ctx.policyPriceCents, message: `offer ${ctx.policyPriceCents}` };
  },
};

describe("runHaggle", () => {
  it("settles within the shop floor and buyer max, with a visible guard rejection", async () => {
    const store = new FakeStore(4000);
    const outcome = await runHaggle(store.negotiation.id, {
      store,
      llm: greedyLlm,
      market: marketProvider,
    });

    expect(outcome.state).toBe("agreed");
    expect(outcome.agreedPriceCents).not.toBeNull();
    expect(outcome.agreedPriceCents!).toBeLessThanOrEqual(4000);

    const seqs = store.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs[0]).toBe(0);

    expect(store.events.some((e) => e.t === "limits.sealed")).toBe(true);
    expect(store.events.some((e) => e.t === "deal.agreed")).toBe(true);
    expect(store.events.some((e) => e.t === "verdict" && e.ok === false)).toBe(true);
  });

  it("resumes without duplicating events", async () => {
    const store = new FakeStore(4000);
    const deps = { store, llm: greedyLlm, market: marketProvider };
    await runHaggle(store.negotiation.id, deps);
    const count = store.events.length;
    await runHaggle(store.negotiation.id, deps);
    expect(store.events.length).toBe(count);
  });

  it("never puts a sealed limit field on an audience:all event", async () => {
    const store = new FakeStore(4000);
    await runHaggle(store.negotiation.id, { store, llm: greedyLlm, market: marketProvider });
    const leaked = store.events
      .filter((e) => e.audience === "all")
      .some((e) => {
        const text = JSON.stringify(e);
        return (
          text.includes("limitCents") || text.includes("saltHex") || text.includes("floorCents")
        );
      });
    expect(leaked).toBe(false);
  });
});
