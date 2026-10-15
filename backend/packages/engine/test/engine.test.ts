import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { MarketRange, Negotiation, NegotiationEvent, Persona, Side } from "@moltol/contracts";
import { commit, newSalt, toHex } from "@moltol/policy";
import type { SealedRecord, StepCommit } from "@moltol/store";
import {
  clampToGuard,
  decidePrice,
  EngineError,
  humanAccept,
  humanOffer,
  runHaggle,
  takeOver,
  type EngineDeps,
  type EngineStore,
  type TurnGenerator,
} from "../src/index";

/** In-memory store with the same commit rules as MoltolStore.commitStep. */
class FakeStore implements EngineStore {
  negotiations = new Map<string, Negotiation>();
  events = new Map<string, NegotiationEvent[]>();
  sealed = new Map<string, SealedRecord>();
  /** Throw on the Nth commit (simulated worker crash). */
  crashOnCommit: number | null = null;
  commits = 0;

  add(n: Negotiation): Negotiation {
    this.negotiations.set(n.id, n);
    this.events.set(n.id, []);
    return n;
  }
  log(id: string): NegotiationEvent[] {
    return this.events.get(id) ?? [];
  }
  async getNegotiation(id: string) {
    const n = this.negotiations.get(id);
    return n ? structuredClone(n) : null;
  }
  async listEvents(id: string, afterSeq = -1) {
    return this.log(id).filter((e) => e.seq > afterSeq);
  }
  async putSealed(record: SealedRecord) {
    const key = `${record.negotiationId}:${record.side}`;
    if (!this.sealed.has(key)) this.sealed.set(key, record);
  }
  async getSealed(id: string, side: Side) {
    return this.sealed.get(`${id}:${side}`) ?? null;
  }
  async commitStep(c: StepCommit) {
    this.commits++;
    if (this.crashOnCommit !== null && this.commits === this.crashOnCommit) {
      throw new Error("simulated crash");
    }
    const n = this.negotiations.get(c.negotiationId)!;
    if (c.actor === "agent" && n.controlled) return null;
    const applies = c.transition ? c.transition.from.includes(n.state) : false;
    if (c.transition?.required && !applies) return null;
    const log = this.log(c.negotiationId);
    if (c.onceType && log.some((e) => e.t === c.onceType)) return null;
    const next = log.length ? log[log.length - 1]!.seq + 1 : 0;
    if (c.expectedSeq !== null && c.expectedSeq !== next) return null;
    const written = c.bodies.map(
      ({ audience, ...body }, i) =>
        ({
          v: 1,
          id: randomUUID(),
          seq: next + i,
          negotiationId: c.negotiationId,
          ts: new Date().toISOString(),
          audience: audience ?? "all",
          ...body,
        }) as NegotiationEvent,
    );
    log.push(...written);
    if (c.patch) Object.assign(n, c.patch);
    if (applies) n.state = c.transition!.to;
    return written;
  }
}

function baseNegotiation(over: Partial<Negotiation> = {}): Negotiation {
  return {
    id: randomUUID(),
    state: "init",
    query: "widget",
    persona: "analyst",
    roundsMax: 8,
    maxTotalCents: 4000,
    currency: "USD",
    agreedPriceCents: null,
    paypalOrderId: null,
    paypalCaptureId: null,
    market: null,
    turns: [],
    basketId: null,
    lineIndex: null,
    shopItemId: null,
    itemEmoji: null,
    itemUnit: null,
    qty: null,
    openCents: null,
    shopPersona: null,
    controlled: false,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function seal(
  store: FakeStore,
  n: Negotiation,
  side: Side,
  limitCents: number,
  domain: number | null,
) {
  const salt = newSalt(16);
  const record: SealedRecord = {
    negotiationId: n.id,
    side,
    commitment: commit({ negotiationId: n.id, side, currency: n.currency, limitCents }, salt),
    limitCents,
    saltHex: toHex(salt),
    domainCents: domain,
  };
  store.sealed.set(`${n.id}:${side}`, record);
}

/** A basket line the way the API creates it: list = buyer ceiling, vendor floor sealed. */
function basketLine(
  store: FakeStore,
  opts: { listCents: number; floorCents: number; rounds?: number; buyer?: Persona; shop?: Persona },
): Negotiation {
  const n = store.add(
    baseNegotiation({
      query: "tomato",
      currency: "INR",
      persona: opts.buyer ?? "storyteller",
      roundsMax: opts.rounds ?? 5,
      maxTotalCents: opts.listCents,
      basketId: randomUUID(),
      lineIndex: 0,
      shopItemId: randomUUID(),
      qty: 1,
      openCents: opts.listCents,
      shopPersona: opts.shop ?? "charmer",
    }),
  );
  seal(store, n, "buyer", opts.listCents, null);
  seal(store, n, "shop", opts.floorCents, opts.listCents);
  return n;
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

const deps = (store: FakeStore, over: Partial<EngineDeps> = {}): EngineDeps => ({
  store,
  llm: greedyLlm,
  market: marketProvider,
  ...over,
});

const turnsOf = (events: NegotiationEvent[]) =>
  events.flatMap((e) => (e.t === "turn" ? [e.turn] : []));

function expectWellFormedLog(events: NegotiationEvent[]) {
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
  expect(events.filter((e) => e.t === "session.started")).toHaveLength(1);
  expect(events.filter((e) => e.t === "limits.sealed")).toHaveLength(1);
  expect(events.filter((e) => e.t === "session.ended")).toHaveLength(1);
}

describe("runHaggle (standalone negotiation)", () => {
  it("settles within the shop floor and buyer max, with a visible guard rejection", async () => {
    const store = new FakeStore();
    const n = store.add(baseNegotiation());
    const outcome = await runHaggle(n.id, deps(store));

    expect(outcome.state).toBe("agreed");
    expect(outcome.agreedPriceCents!).toBeLessThanOrEqual(4000);
    expect(outcome.agreedPriceCents!).toBeGreaterThanOrEqual(
      store.sealed.get(`${n.id}:shop`)!.limitCents,
    );
    const log = store.log(n.id);
    expectWellFormedLog(log);
    expect(log.some((e) => e.t === "deal.agreed")).toBe(true);
    expect(log.some((e) => e.t === "verdict" && e.ok === false && e.audience === "all")).toBe(true);
    expect(store.negotiations.get(n.id)!.state).toBe("agreed");
  });

  it("resumes without duplicating events", async () => {
    const store = new FakeStore();
    const n = store.add(baseNegotiation());
    await runHaggle(n.id, deps(store));
    const count = store.log(n.id).length;
    await runHaggle(n.id, deps(store));
    expect(store.log(n.id).length).toBe(count);
  });

  it("resumes mid-haggle after a crash and finishes with one consistent log", async () => {
    const reference = new FakeStore();
    const r = reference.add(baseNegotiation({ id: randomUUID() }));
    await runHaggle(r.id, deps(reference));

    const store = new FakeStore();
    const n = store.add(baseNegotiation());
    store.crashOnCommit = 3;
    await expect(runHaggle(n.id, deps(store))).rejects.toThrow(/simulated crash/);
    const partial = store.log(n.id).length;
    expect(partial).toBeGreaterThan(0);
    store.crashOnCommit = null;
    const outcome = await runHaggle(n.id, deps(store));
    expect(outcome.state).toBe("agreed");
    expectWellFormedLog(store.log(n.id));
  });

  it("never puts a sealed limit or pre-reveal fairness on an audience:all event", async () => {
    const store = new FakeStore();
    const n = store.add(baseNegotiation());
    await runHaggle(n.id, deps(store));
    for (const e of store.log(n.id).filter((x) => x.audience === "all")) {
      const text = JSON.stringify(e);
      expect(text).not.toMatch(/limitCents|saltHex|floorCents/);
      if (e.t === "deal.agreed") expect(e.fairness).toBeUndefined();
    }
  });

  it("meets the shop's last ask in the final round instead of jumping to its own ceiling", async () => {
    const store = new FakeStore();
    const n = store.add(baseNegotiation({ maxTotalCents: 1_000_000, roundsMax: 3 }));
    const outcome = await runHaggle(n.id, deps(store));
    expect(outcome.state).toBe("agreed");
    const turns = turnsOf(store.log(n.id));
    expect(turns.some((t) => t.actor === "buyer" && t.priceCents === 1_000_000)).toBe(false);
    const asks = turns.filter((t) => t.actor === "shop" && t.kind === "counter");
    expect(outcome.agreedPriceCents!).toBeLessThanOrEqual(asks[asks.length - 1]!.priceCents!);
  });

  it("walks away without naming its floor when there is no zone of agreement", async () => {
    const store = new FakeStore();
    const n = store.add(baseNegotiation({ maxTotalCents: 500, roundsMax: 4 }));
    const outcome = await runHaggle(n.id, deps(store));
    expect(outcome.state).toBe("no_deal");
    const floor = store.sealed.get(`${n.id}:shop`)!.limitCents;
    const turns = turnsOf(store.log(n.id));
    const last = turns[turns.length - 1]!;
    expect(last.kind).toBe("walkaway");
    expect(last.priceCents).toBeUndefined();
    expect(turns.some((t) => t.actor === "shop" && t.priceCents === floor)).toBe(false);
    expect(store.negotiations.get(n.id)!.state).toBe("no_deal");
  });

  it("publishes every verdict, and never the number a rejection turned down", async () => {
    // The buyer's anchor sits at its ceiling, so a +2% nudge is in-band but over the limit.
    const store = new FakeStore();
    const n = store.add(baseNegotiation({ maxTotalCents: 4000, roundsMax: 3 }));
    const pushy: TurnGenerator = {
      async generate(ctx) {
        return { priceCents: Math.round(ctx.policyPriceCents * 1.02), message: "a bit more" };
      },
    };
    const highMarket = {
      getComps: async () => ({ ...market, medianCents: 10_000, p25Cents: 9_000, p75Cents: 11_000 }),
    };
    await runHaggle(n.id, deps(store, { llm: pushy, market: highMarket }));
    const verdicts = store.log(n.id).filter((e) => e.t === "verdict");
    const rejected = verdicts.filter((e) => e.t === "verdict" && !e.ok);
    expect(rejected.length).toBeGreaterThan(0);
    expect(verdicts.every((v) => v.audience === "all")).toBe(true);
    for (const v of rejected) expect(v.t === "verdict" && v.proposedCents).toBeFalsy();
    expect(store.log(n.id).map((e) => e.seq)).toEqual(store.log(n.id).map((_, i) => i));
  });

  it("paces visible turns but not the opening commitments", async () => {
    const store = new FakeStore();
    const n = store.add(baseNegotiation({ roundsMax: 3 }));
    const sleeps: number[] = [];
    await runHaggle(
      n.id,
      deps(store, { turnDelayMs: 900, sleep: async (ms) => void sleeps.push(ms) }),
    );
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.every((ms) => ms === 900)).toBe(true);
    // one pause per committed turn step, none for session.started/limits.sealed
    const turnSteps = store.log(n.id).filter((e) => e.t === "turn").length;
    expect(sleeps.length).toBeLessThanOrEqual(turnSteps);
  });
});

describe("runHaggle (basket line against a real shop)", () => {
  const personas: Persona[] = ["charmer", "stoic", "storyteller", "analyst"];
  const prices: [number, number][] = [
    [4000, 2500],
    [4000, 3999],
    [4000, 4000],
    [29_000, 24_000],
    [1000, 500],
    [2549, 1999],
    [100, 100],
  ];

  it("always lands on a price between the vendor's floor and the list price", async () => {
    for (const [list, floor] of prices) {
      for (const rounds of [2, 3, 5, 8]) {
        for (const buyer of personas) {
          for (const shop of personas) {
            const store = new FakeStore();
            const n = basketLine(store, {
              listCents: list,
              floorCents: floor,
              rounds,
              buyer,
              shop,
            });
            const outcome = await runHaggle(n.id, deps(store));
            expect(outcome.state, `${list}/${floor} r${rounds} ${buyer}/${shop}`).toBe("agreed");
            expect(outcome.agreedPriceCents!).toBeGreaterThanOrEqual(floor);
            expect(outcome.agreedPriceCents!).toBeLessThanOrEqual(list);
            for (const t of turnsOf(store.log(n.id))) {
              if (t.priceCents === undefined) continue;
              if (t.actor === "shop") expect(t.priceCents).toBeGreaterThanOrEqual(floor);
              expect(t.priceCents).toBeLessThanOrEqual(list);
            }
            expectWellFormedLog(store.log(n.id));
          }
        }
      }
    }
  });

  it("gives the buyer a better price with more rounds of patience", async () => {
    const run = async (rounds: number) => {
      const store = new FakeStore();
      const n = basketLine(store, { listCents: 4000, floorCents: 2500, rounds, buyer: "stoic" });
      return (await runHaggle(n.id, deps(store))).agreedPriceCents!;
    };
    expect(await run(8)).toBeLessThan(await run(3));
  });

  it("refuses to run a basket line whose limits were never sealed", async () => {
    const store = new FakeStore();
    const n = store.add(baseNegotiation({ basketId: randomUUID(), openCents: 4000 }));
    await expect(runHaggle(n.id, deps(store))).rejects.toThrow(/sealed limits/);
  });
});

describe("human takeover", () => {
  async function started(store: FakeStore, n: Negotiation, steps: number) {
    // Run the agent for a few steps, then stop it by crashing the next commit.
    store.crashOnCommit = store.commits + steps + 1;
    await runHaggle(n.id, deps(store)).catch(() => {});
    store.crashOnCommit = null;
  }

  it("stops the agent: the runner hands over without moving", async () => {
    const store = new FakeStore();
    const n = basketLine(store, { listCents: 4000, floorCents: 2500 });
    await started(store, n, 2);
    await takeOver(n.id, deps(store));
    const before = store.log(n.id).length;
    const outcome = await runHaggle(n.id, deps(store));
    expect(outcome.state).toBe("handed_over");
    expect(store.log(n.id).length).toBe(before);
    expect(store.log(n.id).some((e) => e.t === "control.changed")).toBe(true);
  });

  it("answers a pending agent offer when the human takes over", async () => {
    const store = new FakeStore();
    const n = basketLine(store, { listCents: 4000, floorCents: 2500 });
    await started(store, n, 2); // start + the buyer's opening offer: the shop owes an answer
    const result = await takeOver(n.id, deps(store));
    const turns = turnsOf(store.log(n.id));
    expect(turns[turns.length - 1]!.actor).toBe("shop");
    expect(result.negotiation.controlled).toBe(true);
  });

  it("counters a lowball, holds above the floor, and never walks away", async () => {
    const store = new FakeStore();
    const n = basketLine(store, { listCents: 4000, floorCents: 2500, rounds: 3 });
    await takeOver(n.id, deps(store));
    let lastAsk = 4000;
    for (let i = 0; i < 8; i++) {
      const r = await humanOffer(n.id, 1000, deps(store));
      expect(r.accepted).toBe(false);
      expect(r.counterCents).not.toBeNull();
      expect(r.counterCents!).toBeLessThanOrEqual(lastAsk);
      expect(r.counterCents!).toBeGreaterThan(2500);
      lastAsk = r.counterCents!;
    }
    expect(store.log(n.id).some((e) => e.t === "session.ended")).toBe(false);
    const done = await humanAccept(n.id, deps(store));
    expect(done.accepted).toBe(true);
    expect(done.negotiation.agreedPriceCents).toBe(lastAsk);
    expect(done.negotiation.state).toBe("agreed");
  });

  it("an offer at or above the ask takes the ask, not the higher number", async () => {
    const store = new FakeStore();
    const n = basketLine(store, { listCents: 4000, floorCents: 2500 });
    await takeOver(n.id, deps(store));
    // The shop opens at its list price and concedes from the next round on.
    expect((await humanOffer(n.id, 2600, deps(store))).counterCents).toBe(4000);
    const second = await humanOffer(n.id, 2600, deps(store));
    expect(second.accepted).toBe(false);
    const ask = second.counterCents!;
    expect(ask).toBeLessThan(4000);
    const take = await humanOffer(n.id, ask + 1, deps(store));
    expect(take.accepted).toBe(true);
    expect(take.negotiation.agreedPriceCents).toBe(ask);
  });

  it("refuses an offer above the sealed ceiling and writes nothing", async () => {
    const store = new FakeStore();
    const n = basketLine(store, { listCents: 4000, floorCents: 2500 });
    await takeOver(n.id, deps(store));
    const before = store.log(n.id).length;
    await expect(humanOffer(n.id, 4001, deps(store))).rejects.toMatchObject({
      code: "above_ceiling",
    });
    expect(store.log(n.id).length).toBe(before);
  });

  it("requires a takeover before a human offer", async () => {
    const store = new FakeStore();
    const n = basketLine(store, { listCents: 4000, floorCents: 2500 });
    await expect(humanOffer(n.id, 3000, deps(store))).rejects.toBeInstanceOf(EngineError);
  });

  it("accept takes the lane over and closes at the shop's ask", async () => {
    const store = new FakeStore();
    const n = basketLine(store, { listCents: 4000, floorCents: 2500 });
    await started(store, n, 3);
    const r = await humanAccept(n.id, deps(store));
    expect(r.accepted).toBe(true);
    const price = r.negotiation.agreedPriceCents!;
    expect(price).toBeGreaterThanOrEqual(2500);
    expect(price).toBeLessThanOrEqual(4000);
    expectWellFormedLog(store.log(n.id));
    await expect(takeOver(n.id, deps(store))).rejects.toMatchObject({ code: "ended" });
  });

  it("accepting before any turn closes at the sticker price", async () => {
    const store = new FakeStore();
    const n = basketLine(store, { listCents: 4000, floorCents: 2500 });
    const r = await humanAccept(n.id, deps(store));
    expect(r.negotiation.agreedPriceCents).toBe(4000);
    expect(r.negotiation.state).toBe("agreed");
  });

  it("a takeover during the runner's pause wins: the agent's pending move is dropped", async () => {
    const store = new FakeStore();
    const n = basketLine(store, { listCents: 4000, floorCents: 2500, rounds: 8 });
    let tookOver = false;
    const outcome = await runHaggle(
      n.id,
      deps(store, {
        turnDelayMs: 1,
        sleep: async () => {
          if (!tookOver && turnsOf(store.log(n.id)).length >= 2) {
            tookOver = true;
            await takeOver(n.id, deps(store));
          }
        },
      }),
    );
    expect(outcome.state).toBe("handed_over");
    const log = store.log(n.id);
    const controlAt = log.findIndex((e) => e.t === "control.changed");
    expect(controlAt).toBeGreaterThan(-1);
    // after the takeover only the shop may answer a pending offer — no further buyer agent turn
    const after = log.slice(controlAt).flatMap((e) => (e.t === "turn" ? [e.turn] : []));
    expect(after.every((t) => t.actor === "shop")).toBe(true);
    expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i));
  });
});

describe("price guard", () => {
  it("never falls back to a policy price that breaks the guard", () => {
    // whole-unit rounding put the target past a non-round floor
    const d = decidePrice({
      side: "shop",
      targetCents: 2500,
      proposedCents: 99_999,
      bandPct: 0.03,
      limitCents: 2549,
      maxTotalCents: 4000,
    });
    expect(d.usedCents).toBe(2549);
    expect(
      clampToGuard({ side: "buyer", priceCents: 4100, limitCents: 4051, maxTotalCents: 4051 }),
    ).toBe(4051);
  });

  it("labels why a proposal lost", () => {
    const band = decidePrice({
      side: "buyer",
      targetCents: 3000,
      proposedCents: 2000,
      bandPct: 0.03,
      limitCents: 4000,
      maxTotalCents: 4000,
    });
    expect(band.rejectedBy).toBe("band");
    const limit = decidePrice({
      side: "buyer",
      targetCents: 4000,
      proposedCents: 4080,
      bandPct: 0.03,
      limitCents: 4000,
      maxTotalCents: 4000,
    });
    expect(limit.rejectedBy).toBe("limit");
    expect(limit.usedCents).toBe(4000);
  });
});
