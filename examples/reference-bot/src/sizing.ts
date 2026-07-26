export const calculateBufferedEntrySize = ({
  configuredTradeSize,
  maximumTradeSize,
  aggregateExposure,
  maximumAggregateExposure,
  yesRealPool,
  noRealPool,
  yesActivated,
  noActivated,
  activationLimit,
  activationBuffer,
}: {
  configuredTradeSize: bigint;
  maximumTradeSize: bigint;
  aggregateExposure: bigint;
  maximumAggregateExposure: bigint;
  yesRealPool: bigint;
  noRealPool: bigint;
  yesActivated: boolean;
  noActivated: boolean;
  activationLimit: bigint;
  activationBuffer: bigint;
}): bigint => {
  const remainingExposure = maximumAggregateExposure - aggregateExposure;
  const usableActivation = activationLimit - activationBuffer;
  const yesCapacity = usableActivation - yesRealPool;
  const noCapacity = usableActivation - noRealPool;
  const sideCapacities = [
    ...(yesActivated ? [] : [yesCapacity]),
    ...(noActivated ? [] : [noCapacity]),
  ];
  if (sideCapacities.length === 0) return 0n;
  return [configuredTradeSize, maximumTradeSize, remainingExposure, ...sideCapacities]
    .reduce((minimum, value) => value < minimum ? value : minimum);
};
