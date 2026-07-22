import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { assertFairProbability, estimateFairProbability } from "../src/strategy.js";

describe("estimator seam", () => {
  it("custom_estimator_replaces_only_strategy_file_contract", () => {
    expect(estimateFairProbability({ currentPrice: 101, strikePrice: 100, secondsRemaining: 60, priceHistory: [] })).toBe(0.51);
    expect(readFileSync(new URL("../src/bot.ts", import.meta.url), "utf8")).toContain('from "./strategy.js"');
  });

  it("nan_infinite_below_zero_and_above_one_probabilities_are_rejected", () => {
    for (const value of [NaN, Infinity, -0.01, 1.01]) expect(() => assertFairProbability(value)).toThrow();
  });

  it("no_probability_or_profitability_claim_is_encoded_in_example_estimator", () => {
    const source = readFileSync(new URL("../src/strategy.ts", import.meta.url), "utf8");
    expect(source).toContain("Educational placeholder only");
    expect(source).not.toMatch(/profitable|accurate|guarantee|win rate/i);
  });
});
