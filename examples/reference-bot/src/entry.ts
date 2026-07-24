import type { ActionCheckpoint, ExecutableQuote, QuoteSide } from "@stryke/sdk";

import type { ReferenceBotConfig } from "./config.js";
import { assertFairProbability } from "./strategy.js";

export type EntryDecision = {
  action: "buy" | "skip" | "blocked" | "dry_run";
  reason: string;
  side: QuoteSide;
  fairProbability: number;
  sideFairProbability: number;
  quoteProbability: number;
  edgeBps: number;
  safetyChecks: Readonly<Record<string, boolean>>;
  quoteId: string;
};

export const decideEntry = ({
  fairProbability,
  quote,
  config,
  secondsRemaining,
  tradeSizeLamports,
  aggregateExposureLamports,
  openPositions,
  dataFresh,
  checkpoint,
}: {
  fairProbability: number;
  quote: ExecutableQuote;
  config: ReferenceBotConfig;
  secondsRemaining: number;
  tradeSizeLamports: bigint;
  aggregateExposureLamports: bigint;
  openPositions: number;
  dataFresh: boolean;
  checkpoint?: ActionCheckpoint;
}): EntryDecision => {
  assertFairProbability(fairProbability);
  const sideFairProbability = quote.side === "yes" ? fairProbability : 1 - fairProbability;
  const quoteProbability = quote.executableProbabilityBps / 10_000;
  const edgeBps = Math.round((sideFairProbability - quoteProbability) * 10_000);
  const safetyChecks = {
    edge: edgeBps >= config.minimumEntryEdgeBps,
    priceImpact: quote.priceImpactBps <= config.maximumPriceImpactBps,
    time: secondsRemaining >= config.minimumSecondsToExpiry,
    size: tradeSizeLamports > 0n && tradeSizeLamports <= config.maximumTradeSizeLamports,
    positions: openPositions < config.maximumOpenPositions,
    aggregateExposure: aggregateExposureLamports + tradeSizeLamports <= config.maximumAggregateExposureLamports,
    fresh: dataFresh,
    checkpoint: checkpoint?.state !== "submitted" && checkpoint?.state !== "unknown",
    killSwitch: !config.killSwitchEnabled,
  } as const;
  const failed = Object.entries(safetyChecks).find(([, passed]) => !passed)?.[0];
  const base = { side: quote.side, fairProbability, sideFairProbability, quoteProbability, edgeBps, safetyChecks, quoteId: quote.quoteId };
  if (failed) return { ...base, action: failed === "edge" ? "skip" : "blocked", reason: failed };
  if (config.readOnlyMode || !config.liveTradingEnabled) {
    return { ...base, action: "dry_run", reason: config.readOnlyMode ? "read_only" : "live_off" };
  }
  return { ...base, action: "buy", reason: "entry_edge_and_safety_passed" };
};
