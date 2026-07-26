import { describe, expect, it } from "vitest";
import { buildVolatilitySnapshot, volatilityAdjustedProbabilities, type FairProbabilityInput } from "../src/strategy.js";

const settings = { lookbackSeconds: 100, minimumHistoryCoverageBps: 8_000, minimumVolatilityBpsPerSqrtHour: 5, maximumVolatilityBpsPerSqrtHour: 2_000, maximumModelProbabilityBps: 9_500 };
const history = (prices: number[]) => prices.map((price, index) => ({ price, publishTime: index * 20 }));
const input = (currentPrice: number, secondsRemaining: number, prices = [100, 100.1, 99.9, 100.2, 100, currentPrice]): FairProbabilityInput => ({ currentPrice, strikePrice: 100, secondsRemaining, priceHistory: history(prices) });

describe("volatility-adjusted probability", () => {
  it("probability_increases_with_positive_log_distance", () => {
    expect(volatilityAdjustedProbabilities(input(101, 60), settings).yesProbability).toBeGreaterThan(volatilityAdjustedProbabilities(input(100, 60), settings).yesProbability);
  });
  it("probability_moves_toward_half_as_volatility_increases", () => {
    const calm = volatilityAdjustedProbabilities(input(101, 60, [100, 100.05, 100, 100.05, 100, 101]), settings).yesProbability;
    const volatile = volatilityAdjustedProbabilities(input(101, 60, [100, 104, 96, 104, 96, 101]), settings).yesProbability;
    expect(Math.abs(volatile - 0.5)).toBeLessThan(Math.abs(calm - 0.5));
  });
  it("same_lead_is_more_decisive_near_expiry", () => {
    expect(volatilityAdjustedProbabilities(input(101, 10), settings).yesProbability).toBeGreaterThan(volatilityAdjustedProbabilities(input(101, 300), settings).yesProbability);
  });
  it("yes_and_no_are_complementary_after_clamp", () => {
    for (const price of [50, 100, 150]) {
      const result = volatilityAdjustedProbabilities(input(price, 60), settings);
      expect(result.yesProbability + result.noProbability).toBeCloseTo(1, 12);
      expect(result.yesProbability).toBeGreaterThanOrEqual(0.05);
      expect(result.yesProbability).toBeLessThanOrEqual(0.95);
    }
  });
  it("history_window_uses_elapsed_time_not_point_count", () => {
    const snapshot = buildVolatilitySnapshot(input(100, 60), settings);
    expect(snapshot).toMatchObject({ lookbackSeconds: 100, coverageBps: 10_000, pointCount: 6 });
  });
  it("stale_sparse_unordered_or_invalid_history_blocks_entry", () => {
    const bad = [
      { ...input(100, 60), priceHistory: history([100, 100.1]) },
      { ...input(100, 60), priceHistory: [{ price: 100, publishTime: 2 }, { price: 101, publishTime: 1 }] },
      { ...input(100, 60), priceHistory: [{ price: 0, publishTime: 0 }, { price: 100, publishTime: 100 }] },
    ];
    for (const value of bad) expect(() => volatilityAdjustedProbabilities(value, settings)).toThrow();
  });
});
