import type { FairProbabilityInput } from "../strategy.js";
import { buildVolatilitySnapshot, type VolatilitySettings, type VolatilitySnapshot } from "./history.js";

const normalCdf = (value: number): number => {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return 0.5 * (1 + erf);
};

export type VolatilityProbabilityResult = {
  yesProbability: number;
  noProbability: number;
  snapshot: VolatilitySnapshot;
};

export const volatilityAdjustedProbabilities = (
  input: FairProbabilityInput,
  settings: VolatilitySettings
): VolatilityProbabilityResult => {
  const snapshot = buildVolatilitySnapshot(input, settings);
  const z = Math.log(input.currentPrice / input.strikePrice) / snapshot.sigmaForRemainingTime;
  if (!Number.isFinite(z)) throw new RangeError("Volatility-adjusted z-score is invalid");
  const maximum = settings.maximumModelProbabilityBps / 10_000;
  if (!Number.isFinite(maximum) || maximum <= 0.5 || maximum >= 1) throw new RangeError("Maximum model probability must be between 50% and 100%");
  const yesProbability = Math.min(maximum, Math.max(1 - maximum, normalCdf(z)));
  return { yesProbability, noProbability: 1 - yesProbability, snapshot };
};
