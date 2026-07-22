import { StrykeSdkError } from "./errors.js";

export type SettlementObservation = {
  feedId: string;
  publishTime: number;
  value: bigint;
  verified: boolean;
  raw: Readonly<Record<string, unknown>>;
};

export const firstVerifiedExpiryCrossingObservation = ({
  expectedFeedId,
  expiryTs,
  maximumWindowSeconds = 300,
  observations,
}: {
  expectedFeedId: string;
  expiryTs: number;
  maximumWindowSeconds?: number;
  observations: readonly SettlementObservation[];
}): SettlementObservation => {
  const ordered = [...observations].sort((a, b) => a.publishTime - b.publishTime);
  let previousPublishTime: number | undefined;
  for (const observation of ordered) {
    if (
      observation.feedId.toLowerCase() !== expectedFeedId.toLowerCase() ||
      !observation.verified
    ) {
      continue;
    }
    const crosses =
      previousPublishTime !== undefined &&
      previousPublishTime < expiryTs &&
      expiryTs <= observation.publishTime;
    if (
      crosses &&
      observation.publishTime <= expiryTs + maximumWindowSeconds
    ) {
      return observation;
    }
    previousPublishTime = observation.publishTime;
  }
  throw new StrykeSdkError(
    "position_state",
    "Authoritative expiry-crossing settlement evidence is unavailable"
  );
};

export const settlementOutcome = (
  resolvedValue: bigint,
  targetValue: bigint
): "yes" | "no" => (resolvedValue > targetValue ? "yes" : "no");
