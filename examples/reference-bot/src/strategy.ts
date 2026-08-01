export type FairProbabilityInput = {
  currentPrice: number;
  strikePrice: number;
  secondsRemaining: number;
  priceHistory: readonly { price: number; publishTime: number }[];
};

export type BaselineEstimator = "distance_to_strike" | "distance_momentum";
export type ReferenceEstimator = BaselineEstimator | "volatility_adjusted_probability" | "polymarket_early" | "polymarket_late" | "polymarket_relative_value";

export type EstimatorSettings = import("./strategy/history.js").VolatilitySettings;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const validateInput = (input: FairProbabilityInput): void => {
  if (
    !Number.isFinite(input.currentPrice) ||
    !Number.isFinite(input.strikePrice) ||
    !Number.isFinite(input.secondsRemaining) ||
    input.currentPrice <= 0 ||
    input.strikePrice <= 0 ||
    input.secondsRemaining <= 0 ||
    input.priceHistory.length < 2
  ) {
    throw new RangeError("Estimator requires positive prices, time, and at least two history points");
  }
  let previous = -Infinity;
  for (const point of input.priceHistory) {
    if (
      !Number.isFinite(point.price) ||
      !Number.isSafeInteger(point.publishTime) ||
      point.price <= 0 ||
      point.publishTime <= previous
    ) {
      throw new RangeError("Estimator price history must be positive and strictly ordered");
    }
    previous = point.publishTime;
  }
};

export const distanceToStrikeProbability = (input: FairProbabilityInput): number => {
  validateInput(input);
  const distanceBps = ((input.currentPrice - input.strikePrice) / input.strikePrice) * 10_000;
  const timeScale = Math.max(1, Math.sqrt(input.secondsRemaining / 300));
  const score = clamp(distanceBps / (500 * timeScale), -4.595, 4.595);
  return clamp(1 / (1 + Math.exp(-score)), 0.01, 0.99);
};

export const distanceMomentumProbability = (input: FairProbabilityInput): number => {
  const base = distanceToStrikeProbability(input);
  const oldest = input.priceHistory[0]!.price;
  const momentumBps = ((input.currentPrice - oldest) / oldest) * 10_000;
  return clamp(base + clamp(momentumBps / 20_000, -0.15, 0.15), 0.01, 0.99);
};

export const estimateFairProbability = (
  input: FairProbabilityInput,
  estimator: ReferenceEstimator = "distance_to_strike",
  settings?: EstimatorSettings
): number => {
  if (estimator === "volatility_adjusted_probability") {
    if (!settings) throw new RangeError("Volatility estimator settings are required");
    return volatilityAdjustedProbabilities(input, settings).yesProbability;
  }
  // Educational baselines only. They make no accuracy or profitability claim.
  return estimator === "distance_momentum"
    ? distanceMomentumProbability(input)
    : distanceToStrikeProbability(input);
};

export { buildVolatilitySnapshot, type VolatilitySettings, type VolatilitySnapshot } from "./strategy/history.js";
export { volatilityAdjustedProbabilities, type VolatilityProbabilityResult } from "./strategy/volatility-probability.js";

export const assertFairProbability = (value: number): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("Fair probability must be finite and between 0 and 1");
  }
  return value;
};
import { volatilityAdjustedProbabilities } from "./strategy/volatility-probability.js";
