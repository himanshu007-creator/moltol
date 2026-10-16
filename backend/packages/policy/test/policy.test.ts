import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  clampToBand,
  commit,
  concession,
  fairnessScore,
  newSalt,
  openingAnchor,
  shouldAccept,
  thresholdCommit,
  thresholdProve,
  thresholdVerify,
  validateOffer,
  verifyFairDeal,
  verifyReveal,
  withinBand,
} from "../src/index";

const ctx = (limitCents: number, side: "buyer" | "shop" = "buyer") => ({
  negotiationId: "00000000-0000-4000-8000-000000000001",
  side,
  currency: "USD",
  limitCents,
});

describe("concession", () => {
  it("is monotonic and bounded for both sides", () => {
    let prevBuyer = -Infinity;
    let prevShop = Infinity;
    for (let t = 0; t <= 8; t++) {
      const b = concession({ openCents: 2000, limitCents: 4000, t, T: 8, beta: 0.6 });
      const s = concession({ openCents: 5000, limitCents: 3000, t, T: 8, beta: 0.6 });
      expect(b).toBeGreaterThanOrEqual(prevBuyer);
      expect(s).toBeLessThanOrEqual(prevShop);
      expect(b).toBeLessThanOrEqual(4000);
      expect(s).toBeGreaterThanOrEqual(3000);
      prevBuyer = b;
      prevShop = s;
    }
  });

  it("property: never crosses its own limit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 1, max: 12 }),
        (a, b, T) => {
          const open = Math.min(a, b);
          const limit = Math.max(a, b);
          for (let t = 0; t <= T + 2; t++) {
            const v = concession({ openCents: open, limitCents: limit, t, T, beta: 0.6 });
            expect(v).toBeGreaterThanOrEqual(open);
            expect(v).toBeLessThanOrEqual(limit);
          }
        },
      ),
    );
  });
});

describe("guard", () => {
  it("rejects a buyer offer above the sealed max", () => {
    expect(
      validateOffer({ side: "buyer", priceCents: 4100, limitCents: 4000, maxTotalCents: 5000 }).ok,
    ).toBe(false);
  });
  it("rejects a shop offer below the sealed floor", () => {
    expect(
      validateOffer({ side: "shop", priceCents: 2900, limitCents: 3000, maxTotalCents: 5000 }).ok,
    ).toBe(false);
  });
  it("rejects offers above the buyer mandate", () => {
    expect(
      validateOffer({ side: "buyer", priceCents: 6000, limitCents: 7000, maxTotalCents: 5000 }).ok,
    ).toBe(false);
  });
  it("accepts an in-bounds offer", () => {
    expect(
      validateOffer({ side: "shop", priceCents: 3500, limitCents: 3000, maxTotalCents: 5000 }).ok,
    ).toBe(true);
  });

  it("property: clampToBand always lands inside the band", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: -100000, max: 100000 }),
        (policy, proposed) => {
          const used = clampToBand(policy, proposed, 0.03);
          expect(withinBand(policy, used, 0.03) || used === Math.round(policy)).toBe(true);
          expect(used).toBeGreaterThanOrEqual(Math.floor(policy * 0.97));
          expect(used).toBeLessThanOrEqual(Math.ceil(policy * 1.03));
        },
      ),
    );
  });
});

describe("shouldAccept", () => {
  it("buyer accepts at or below next offer and within max", () => {
    expect(
      shouldAccept({
        side: "buyer",
        incomingCents: 3500,
        myNextOfferCents: 3600,
        myLimitCents: 4000,
      }),
    ).toBe(true);
    expect(
      shouldAccept({
        side: "buyer",
        incomingCents: 3700,
        myNextOfferCents: 3600,
        myLimitCents: 4000,
      }),
    ).toBe(false);
  });
});

describe("commit / reveal", () => {
  it("verifies a correct reveal and binds context", () => {
    const salt = newSalt();
    const c = commit(ctx(4000), salt);
    expect(verifyReveal(c, ctx(4000), salt)).toBe(true);
    expect(verifyReveal(c, ctx(4100), salt)).toBe(false);
    // different side => different commitment
    expect(verifyReveal(c, ctx(4000, "shop"), salt)).toBe(false);
  });
});

describe("proof of fair deal", () => {
  const negotiationId = "00000000-0000-4000-8000-000000000002";
  const bs = newSalt();
  const ss = newSalt();

  it("passes for a fair deal inside the ZOPA", () => {
    const proof = verifyFairDeal({
      negotiationId,
      currency: "USD",
      priceCents: 3500,
      buyer: { commitment: commit({ ...ctx(4000), negotiationId }, bs), maxCents: 4000, salt: bs },
      shop: {
        commitment: commit({ ...ctx(3000, "shop"), negotiationId }, ss),
        floorCents: 3000,
        salt: ss,
      },
    });
    expect(proof.verified).toBe(true);
    expect(proof.fairness).toBe(100);
    expect(proof.buyerSavedCents).toBe(500);
  });

  it("fails when the price breached a limit", () => {
    const proof = verifyFairDeal({
      negotiationId,
      currency: "USD",
      priceCents: 4200,
      buyer: { commitment: commit({ ...ctx(4000), negotiationId }, bs), maxCents: 4000, salt: bs },
      shop: {
        commitment: commit({ ...ctx(3000, "shop"), negotiationId }, ss),
        floorCents: 3000,
        salt: ss,
      },
    });
    expect(proof.verified).toBe(false);
  });
});

describe("zero-knowledge threshold proof", () => {
  it("proves a shop floor below a claimed price without revealing it", () => {
    const seed = newSalt(32);
    const input = {
      negotiationId: "00000000-0000-4000-8000-000000000003",
      side: "shop" as const,
      domainCents: 5000,
      secretCents: 3000,
    };
    const commitment = thresholdCommit(input, seed);
    const proof = thresholdProve(input, 3500, seed);
    expect(thresholdVerify({ ...input, claimedCents: 3500, commitment, proof })).toBe(true);
  });

  it("cannot prove a threshold its secret does not satisfy", () => {
    const seed = newSalt(32);
    const input = {
      negotiationId: "00000000-0000-4000-8000-000000000004",
      side: "shop" as const,
      domainCents: 5000,
      secretCents: 3000,
    };
    expect(() => thresholdProve(input, 2500, seed)).toThrow();
  });
});

describe("anchors and fairness", () => {
  it("never opens above the mandate", () => {
    expect(openingAnchor({ p25Cents: 9000, maxTotalCents: 4000 })).toBeLessThanOrEqual(4000);
  });
  it("anchors on the market, not on how big the mandate is", () => {
    const modest = openingAnchor({ p25Cents: 3000, maxTotalCents: 4000 });
    const generous = openingAnchor({ p25Cents: 3000, maxTotalCents: 1_000_000 });
    expect(generous).toBe(modest);
    expect(generous).toBeLessThan(3000);
  });
  it("scores an even split at 100", () => {
    expect(fairnessScore(3500, 3000, 4000)).toBe(100);
    expect(fairnessScore(3000, 3000, 4000)).toBe(0);
  });
});
