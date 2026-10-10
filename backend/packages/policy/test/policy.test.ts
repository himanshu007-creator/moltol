import { describe, expect, it } from "vitest";
import {
  commit,
  concession,
  fairnessScore,
  newSalt,
  openingAnchor,
  shouldAccept,
  validateOffer,
  verifyProofOfFairDeal,
  verifyReveal,
} from "../src/index";

describe("concession", () => {
  it("is monotonic rising for a buyer", () => {
    let prev = -Infinity;
    for (let t = 0; t <= 8; t++) {
      const v = concession({ openCents: 2000, limitCents: 4000, t, T: 8, beta: 0.6 });
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("is monotonic falling for a shop", () => {
    let prev = Infinity;
    for (let t = 0; t <= 8; t++) {
      const v = concession({ openCents: 5000, limitCents: 3000, t, T: 8, beta: 0.6 });
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it("never crosses its own limit", () => {
    for (let t = 0; t <= 12; t++) {
      const b = concession({ openCents: 2000, limitCents: 4000, t, T: 8, beta: 1.4 });
      const s = concession({ openCents: 5000, limitCents: 3000, t, T: 8, beta: 0.4 });
      expect(b).toBeLessThanOrEqual(4000);
      expect(s).toBeGreaterThanOrEqual(3000);
    }
  });
});

describe("validateOffer", () => {
  it("rejects a buyer offer above the sealed max", () => {
    const v = validateOffer({ side: "buyer", priceCents: 4100, limitCents: 4000, maxTotalCents: 5000 });
    expect(v.ok).toBe(false);
  });

  it("rejects a shop offer below the sealed floor", () => {
    const v = validateOffer({ side: "shop", priceCents: 2900, limitCents: 3000, maxTotalCents: 5000 });
    expect(v.ok).toBe(false);
  });

  it("rejects offers above the buyer mandate", () => {
    const v = validateOffer({ side: "buyer", priceCents: 6000, limitCents: 7000, maxTotalCents: 5000 });
    expect(v.ok).toBe(false);
  });

  it("accepts an in-bounds offer", () => {
    const v = validateOffer({ side: "shop", priceCents: 3500, limitCents: 3000, maxTotalCents: 5000 });
    expect(v.ok).toBe(true);
  });
});

describe("shouldAccept", () => {
  it("buyer accepts at or below next offer and within max", () => {
    expect(shouldAccept({ side: "buyer", incomingCents: 3500, myNextOfferCents: 3600, myLimitCents: 4000 })).toBe(true);
    expect(shouldAccept({ side: "buyer", incomingCents: 3700, myNextOfferCents: 3600, myLimitCents: 4000 })).toBe(false);
  });
});

describe("commit / reveal", () => {
  it("verifies a correct reveal", () => {
    const salt = newSalt();
    const c = commit(4000, salt);
    expect(verifyReveal(c, 4000, salt)).toBe(true);
    expect(verifyReveal(c, 4100, salt)).toBe(false);
  });

  it("rejects tampering: proof fails if the price breached a limit", () => {
    const bs = newSalt();
    const ss = newSalt();
    const proof = verifyProofOfFairDeal({
      buyerCommit: commit(4000, bs),
      buyerMaxCents: 4000,
      buyerSalt: bs,
      shopCommit: commit(3000, ss),
      shopFloorCents: 3000,
      shopSalt: ss,
      priceCents: 4200,
    });
    expect(proof.verified).toBe(false);
  });

  it("passes for a fair deal inside the ZOPA", () => {
    const bs = newSalt();
    const ss = newSalt();
    const proof = verifyProofOfFairDeal({
      buyerCommit: commit(4000, bs),
      buyerMaxCents: 4000,
      buyerSalt: bs,
      shopCommit: commit(3000, ss),
      shopFloorCents: 3000,
      shopSalt: ss,
      priceCents: 3500,
    });
    expect(proof.verified).toBe(true);
    expect(proof.fairness).toBe(100);
    expect(proof.buyerSavedCents).toBe(500);
  });
});

describe("anchors and fairness", () => {
  it("never opens above the mandate", () => {
    const a = openingAnchor({ p25Cents: 9000, maxTotalCents: 4000 });
    expect(a).toBeLessThanOrEqual(4000);
  });

  it("scores an even split at 100", () => {
    expect(fairnessScore(3500, 3000, 4000)).toBe(100);
    expect(fairnessScore(3000, 3000, 4000)).toBe(0);
  });
});
