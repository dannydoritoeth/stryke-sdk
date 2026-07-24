import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { assertFairProbability, estimateFairProbability } from "../src/strategy.js";

const input = (currentPrice = 100, history = [{ price: 99, publishTime: 1 }, { price: 100, publishTime: 2 }]) => ({
  currentPrice, strikePrice: 100, secondsRemaining: 60, priceHistory: history,
});

describe("estimator seam", () => {
  it("bundled_baselines_are_finite_bounded_and_directional", () => {
    for (const estimator of ["distance_to_strike", "distance_momentum"] as const) {
      expect(estimateFairProbability(input(101), estimator)).toBeGreaterThan(0.5);
      expect(estimateFairProbability(input(99), estimator)).toBeLessThan(0.5);
      expect(estimateFairProbability(input(100, [{ price: 100, publishTime: 1 }, { price: 100, publishTime: 2 }]), estimator)).toBe(0.5);
    }
  });

  it("momentum_adjustment_is_bounded", () => {
    const base = estimateFairProbability(input(100, [{ price: 100, publishTime: 1 }, { price: 100, publishTime: 2 }]), "distance_to_strike");
    const adjusted = estimateFairProbability(input(100, [{ price: 1, publishTime: 1 }, { price: 100, publishTime: 2 }]), "distance_momentum");
    expect(adjusted - base).toBeCloseTo(0.15);
  });

  it("invalid_or_unordered_inputs_fail_closed", () => {
    for (const invalid of [input(0), input(100, []), input(100, [{ price: 1, publishTime: 2 }, { price: 2, publishTime: 1 }])]) {
      expect(() => estimateFairProbability(invalid)).toThrow();
    }
  });

  it("nan_infinite_below_zero_and_above_one_probabilities_are_rejected", () => {
    for (const value of [NaN, Infinity, -0.01, 1.01]) expect(() => assertFairProbability(value)).toThrow();
  });

  it("no_probability_or_profitability_claim_is_encoded", () => {
    const source = readFileSync(new URL("../src/strategy.ts", import.meta.url), "utf8");
    expect(source).toContain("Educational baselines only");
    expect(source).not.toMatch(/guarantee|win rate/i);
  });
});
