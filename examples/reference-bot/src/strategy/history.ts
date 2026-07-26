import type { FairProbabilityInput } from "../strategy.js";

export type VolatilitySnapshot = {
  volatilityBpsPerSqrtHour: number;
  sigmaForRemainingTime: number;
  lookbackSeconds: number;
  coverageBps: number;
  pointCount: number;
};

export type VolatilitySettings = {
  lookbackSeconds: number;
  minimumHistoryCoverageBps: number;
  minimumVolatilityBpsPerSqrtHour: number;
  maximumVolatilityBpsPerSqrtHour: number;
  maximumModelProbabilityBps: number;
};

export const buildVolatilitySnapshot = (
  input: FairProbabilityInput,
  settings: VolatilitySettings
): VolatilitySnapshot => {
  if (!Number.isSafeInteger(settings.lookbackSeconds) || settings.lookbackSeconds <= 0 ||
      !Number.isSafeInteger(settings.minimumHistoryCoverageBps) || settings.minimumHistoryCoverageBps < 1 || settings.minimumHistoryCoverageBps > 10_000 ||
      !Number.isFinite(settings.minimumVolatilityBpsPerSqrtHour) || settings.minimumVolatilityBpsPerSqrtHour <= 0 ||
      !Number.isFinite(settings.maximumVolatilityBpsPerSqrtHour) || settings.maximumVolatilityBpsPerSqrtHour < settings.minimumVolatilityBpsPerSqrtHour) {
    throw new RangeError("Volatility settings are invalid");
  }
  const observations = input.priceHistory;
  if (observations.length < 2) throw new RangeError("Volatility history is insufficient");
  let priorTime = -Infinity;
  for (const point of observations) {
    if (!Number.isFinite(point.price) || point.price <= 0 || !Number.isSafeInteger(point.publishTime) || point.publishTime <= priorTime) {
      throw new RangeError("Volatility history must be positive and strictly ordered");
    }
    priorTime = point.publishTime;
  }
  const latestTime = observations.at(-1)!.publishTime;
  const windowStart = latestTime - settings.lookbackSeconds;
  const window = observations.filter((point) => point.publishTime >= windowStart);
  const preceding = observations.filter((point) => point.publishTime < windowStart).at(-1);
  if (preceding) window.unshift(preceding);
  if (window.length < 2) throw new RangeError("Volatility history is insufficient");
  const coveredSeconds = latestTime - window[0]!.publishTime;
  const coverageBps = Math.min(10_000, Math.floor((coveredSeconds * 10_000) / settings.lookbackSeconds));
  if (coverageBps < settings.minimumHistoryCoverageBps) throw new RangeError("Volatility history coverage is insufficient");

  let squaredLogReturns = 0;
  let elapsedSeconds = 0;
  for (let index = 1; index < window.length; index += 1) {
    const previous = window[index - 1]!;
    const current = window[index]!;
    const elapsed = current.publishTime - previous.publishTime;
    if (elapsed <= 0 || previous.price <= 0 || current.price <= 0) throw new RangeError("Volatility history must be positive and strictly ordered");
    const logReturn = Math.log(current.price / previous.price);
    if (!Number.isFinite(logReturn)) throw new RangeError("Volatility return is invalid");
    squaredLogReturns += logReturn * logReturn;
    elapsedSeconds += elapsed;
  }
  if (elapsedSeconds <= 0) throw new RangeError("Volatility elapsed time is invalid");
  const rawBpsPerSqrtHour = Math.sqrt((squaredLogReturns / elapsedSeconds) * 3_600) * 10_000;
  const volatilityBpsPerSqrtHour = Math.min(
    settings.maximumVolatilityBpsPerSqrtHour,
    Math.max(settings.minimumVolatilityBpsPerSqrtHour, rawBpsPerSqrtHour)
  );
  const sigmaForRemainingTime = (volatilityBpsPerSqrtHour / 10_000) * Math.sqrt(input.secondsRemaining / 3_600);
  if (!Number.isFinite(sigmaForRemainingTime) || sigmaForRemainingTime <= 0) throw new RangeError("Volatility snapshot is invalid");
  return { volatilityBpsPerSqrtHour, sigmaForRemainingTime, lookbackSeconds: settings.lookbackSeconds, coverageBps, pointCount: window.length };
};
