export const calculateBufferedEntrySize = ({
  configuredTradeSize,
  maximumTradeSize,
  aggregateExposure,
  maximumAggregateExposure,
  yesRealPool,
  noRealPool,
  activationLimit,
  activationBuffer,
}: {
  configuredTradeSize: bigint;
  maximumTradeSize: bigint;
  aggregateExposure: bigint;
  maximumAggregateExposure: bigint;
  yesRealPool: bigint;
  noRealPool: bigint;
  activationLimit: bigint;
  activationBuffer: bigint;
}): bigint => {
  const remainingExposure = maximumAggregateExposure - aggregateExposure;
  const usableActivation = activationLimit - activationBuffer;
  const yesCapacity = usableActivation - yesRealPool;
  const noCapacity = usableActivation - noRealPool;
  return [configuredTradeSize, maximumTradeSize, remainingExposure, yesCapacity, noCapacity]
    .reduce((minimum, value) => value < minimum ? value : minimum);
};
