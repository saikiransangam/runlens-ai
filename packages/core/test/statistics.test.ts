import { describe, expect, it } from "vitest";
import {
  classifyStability,
  entropyBits,
  fisherRegressionPValue,
  flakiness,
  passAtK,
  passHatK,
  requiredRuns,
  wilsonInterval,
} from "../src/statistics.js";

describe("wilsonInterval", () => {
  it("matches the textbook value for 17/20", () => {
    const ci = wilsonInterval(17, 20);
    expect(ci.low).toBeCloseTo(0.6396, 3);
    expect(ci.high).toBeCloseTo(0.9476, 3);
  });

  it("stays inside [0, 1] at the extremes", () => {
    const all = wilsonInterval(20, 20);
    expect(all.high).toBe(1);
    expect(all.low).toBeGreaterThan(0.8);
    const none = wilsonInterval(0, 20);
    expect(none.low).toBe(0);
    expect(none.high).toBeLessThan(0.2);
  });

  it("returns the uninformative interval for zero trials", () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1, level: 0.95 });
  });
});

describe("pass@k and pass^k", () => {
  it("pass@1 and pass^1 equal the pass rate", () => {
    expect(passAtK(20, 17, 1)).toBeCloseTo(0.85);
    expect(passHatK(20, 17, 1)).toBeCloseTo(0.85);
  });

  it("pass@k rises and pass^k falls with k", () => {
    expect(passAtK(20, 17, 5)).toBeGreaterThan(0.99);
    // C(17,5)/C(20,5) = 6188/15504
    expect(passHatK(20, 17, 5)).toBeCloseTo(6188 / 15504, 6);
  });

  it("handles all-pass and all-fail", () => {
    expect(passAtK(10, 0, 3)).toBe(0);
    expect(passHatK(10, 10, 3)).toBe(1);
  });
});

describe("stability", () => {
  it("classifies runs", () => {
    expect(classifyStability(20, 20)).toBe("stable-pass");
    expect(classifyStability(0, 20)).toBe("stable-fail");
    expect(classifyStability(10, 20)).toBe("flaky");
  });

  it("flakiness peaks at 50/50", () => {
    expect(flakiness(10, 20)).toBe(1);
    expect(flakiness(20, 20)).toBe(0);
    expect(flakiness(15, 20)).toBeCloseTo(0.5);
  });
});

describe("requiredRuns", () => {
  it("needs ~196 runs for +/-5 points at p=0.85", () => {
    expect(requiredRuns(0.05, 0.85)).toBe(196);
  });
});

describe("fisherRegressionPValue", () => {
  it("is not significant for a one-run drop", () => {
    expect(fisherRegressionPValue(17, 20, 16, 20)).toBeGreaterThan(0.3);
  });

  it("is significant for a large drop", () => {
    expect(fisherRegressionPValue(19, 20, 8, 20)).toBeLessThan(0.001);
  });

  it("is 1 when the current run is better", () => {
    expect(fisherRegressionPValue(10, 20, 20, 20)).toBeCloseTo(1, 6);
  });
});

describe("entropyBits", () => {
  it("is 0 for one path and 1 for an even split of two", () => {
    expect(entropyBits([10])).toBe(0);
    expect(entropyBits([5, 5])).toBeCloseTo(1);
  });
});
