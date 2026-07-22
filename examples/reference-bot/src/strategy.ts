export type FairProbabilityInput = {
  currentPrice: number;
  strikePrice: number;
  secondsRemaining: number;
  priceHistory: readonly { price: number; publishTime: number }[];
};

export const estimateFairProbability = (
  input: FairProbabilityInput
): number => {
  // Educational placeholder only: replace this file with the developer's signal.
  if (input.currentPrice === input.strikePrice) return 0.5;
  return input.currentPrice > input.strikePrice ? 0.51 : 0.49;
};

export const assertFairProbability = (value: number): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("Fair probability must be finite and between 0 and 1");
  }
  return value;
};
