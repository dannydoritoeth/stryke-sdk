import type { ActionCheckpoint, ExecutableQuote, QuoteSide } from "@stryketrade/sdk";

import type { ReferenceBotConfig } from "./config.js";
import { assertFairProbability } from "./strategy.js";
import { activationEntryDecision } from "./activation-policy.js";

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

export type BestEntryDecision = EntryDecision & { quote: ExecutableQuote };

export const decideBestEntry = ({
  fairProbability,
  quotes,
  config,
  secondsRemaining,
  tradeSizeLamports,
  aggregateExposureLamports,
  openPositions,
  dataFresh,
}: {
  fairProbability: number;
  quotes: readonly [ExecutableQuote, ExecutableQuote];
  config: ReferenceBotConfig;
  secondsRemaining: number;
  tradeSizeLamports: bigint;
  aggregateExposureLamports: bigint;
  openPositions: number;
  dataFresh: boolean;
}): BestEntryDecision => {
  if (quotes[0].marketStateVersion !== quotes[1].marketStateVersion || quotes[0].amount !== quotes[1].amount) {
    const unavailable = decideEntry({ fairProbability, quote: quotes[0], config, secondsRemaining, tradeSizeLamports, aggregateExposureLamports, openPositions, dataFresh: false });
    return { ...unavailable, action: "blocked", reason: "paired_quote_mismatch", quote: quotes[0] };
  }
  const decisions = quotes.map((quote) => ({
    quote,
    decision: decideEntry({ fairProbability, quote, config, secondsRemaining, tradeSizeLamports, aggregateExposureLamports, openPositions, dataFresh }),
  }));
  const eligible = decisions.filter(({ decision }) => Object.values(decision.safetyChecks).every(Boolean));
  const ranked = (eligible.length > 0 ? eligible : decisions).sort((left, right) => right.decision.edgeBps - left.decision.edgeBps || left.quote.side.localeCompare(right.quote.side));
  const [best, second] = ranked as [typeof decisions[number], typeof decisions[number] | undefined];
  if (second && best.decision.edgeBps === second.decision.edgeBps) return { ...best.decision, action: "skip", reason: "edge_tie", quote: best.quote };
  return { ...best.decision, quote: best.quote };
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
  const quoteProbability = quote.normalizedSideProbabilityBps / 10_000;
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
    feeFreeOpen: activationEntryDecision(quote).allowed,
  } as const;
  const failed = Object.entries(safetyChecks).find(([, passed]) => !passed)?.[0];
  const base = { side: quote.side, fairProbability, sideFairProbability, quoteProbability, edgeBps, safetyChecks, quoteId: quote.quoteId };
  if (failed) return { ...base, action: failed === "edge" ? "skip" : "blocked", reason: failed };
  if (config.readOnlyMode || !config.liveTradingEnabled) {
    return { ...base, action: "dry_run", reason: config.readOnlyMode ? "read_only" : "live_off" };
  }
  return { ...base, action: "buy", reason: "entry_edge_and_safety_passed" };
};
