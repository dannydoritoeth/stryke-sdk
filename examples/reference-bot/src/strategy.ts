export type FairProbabilityInput = {
  currentPrice: number;
  strikePrice: number;
  secondsRemaining: number;
  priceHistory: readonly { price: number; publishTime: number }[];
};

export const estimateFairProbability = (
  input: FairProbabilityInput
): number => (input.currentPrice > input.strikePrice ? 0.55 : 0.45);
