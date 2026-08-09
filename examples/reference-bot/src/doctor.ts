import { StrykeSdkError, type ExecutableQuote } from "@stryke/sdk";

import type { EntryEvaluation } from "./bot.js";
import type { ReferenceBotConfig, ReferenceBotProfile } from "./config.js";
import { polymarketEntryWindow } from "./strategy/entry-window.js";

export const DOCTOR_SCHEMA_VERSION = "stryke.referenceBotDoctor.v1" as const;

export type DoctorStatus = "READY_FOR_PAPER" | "WAITING_FOR_MARKET" | "READY_FOR_LIVE" | "BLOCKED";

export type DoctorResult = {
  event: "reference_bot_doctor";
  schemaVersion: typeof DOCTOR_SCHEMA_VERSION;
  profile: ReferenceBotProfile;
  status: DoctorStatus;
  reason: string;
  remediation: string;
  marketId?: string;
  nextEligibleAt?: number;
  configuredTradeSizeLamports?: string;
  minimumTradeCollateralUnits?: string;
  quoteIds?: readonly [string, string];
};

const result = (
  profile: ReferenceBotProfile,
  status: DoctorStatus,
  reason: string,
  remediation: string,
  details: Omit<DoctorResult, "event" | "schemaVersion" | "profile" | "status" | "reason" | "remediation"> = {}
): DoctorResult => ({ event: "reference_bot_doctor", schemaVersion: DOCTOR_SCHEMA_VERSION, profile, status, reason, remediation, ...details });

const assertMatchedQuotes = (quotes: readonly [ExecutableQuote, ExecutableQuote], amount: bigint): void => {
  const [first, second] = quotes;
  if (
    first.side === second.side ||
    new Set([first.side, second.side]).size !== 2 ||
    first.marketStateVersion !== second.marketStateVersion ||
    first.amount !== second.amount ||
    first.amount !== amount.toString()
  ) {
    throw new StrykeSdkError("quote_blocked", "Matched YES/NO readiness quotes are inconsistent", true, { phase: "paired_quote_mismatch" });
  }
};

export const classifyDoctorEvaluation = ({
  profile,
  config,
  evaluation,
  nowSeconds = Math.floor(Date.now() / 1_000),
}: {
  profile: ReferenceBotProfile;
  config: ReferenceBotConfig;
  evaluation: EntryEvaluation;
  nowSeconds?: number;
}): DoctorResult => {
  assertMatchedQuotes(evaluation.buyQuotes, evaluation.proposedSizeLamports);
  const market = evaluation.market;
  const common = {
    marketId: market.marketId,
    configuredTradeSizeLamports: config.tradeSizeLamports.toString(),
    ...(market.minimumTradeCollateralUnits === undefined ? {} : { minimumTradeCollateralUnits: market.minimumTradeCollateralUnits }),
    quoteIds: [evaluation.buyQuotes[0].quoteId, evaluation.buyQuotes[1].quoteId] as const,
  };
  if (config.strategy.startsWith("polymarket_") && market.reference.alignmentStatus !== "aligned") {
    return result(profile, "WAITING_FOR_MARKET", market.reference.fallbackReason ?? "reference_not_aligned", "Setup is healthy. Keep the paper process running until an aligned market is available.", { ...common, nextEligibleAt: market.expiryTs });
  }
  if (config.strategy.startsWith("polymarket_")) {
    const window = polymarketEntryWindow({
      mode: config.strategy === "polymarket_late" ? "polymarket_late" : "polymarket_early",
      market,
      quote: evaluation.buyQuotes[0],
      now: nowSeconds,
      earlyWindowSeconds: config.polymarketEarlyWindowSeconds,
      lateWindowSeconds: config.polymarketLateWindowSeconds,
      submissionBufferSeconds: config.polymarketSubmissionBufferSeconds,
    });
    if (!window.eligible) {
      return result(profile, "WAITING_FOR_MARKET", window.reason, "Setup and matched quotes are healthy. Keep the process running for the next eligible strategy window.", { ...common, nextEligibleAt: nowSeconds < window.opensAt ? window.opensAt : market.expiryTs });
    }
    if (!evaluation.polymarketPrices) {
      return result(profile, "BLOCKED", "reference_prices_unavailable", "Check the configured Polymarket endpoint and aligned token identities, then retry.", common);
    }
  }
  return result(profile, profile === "live" ? "READY_FOR_LIVE" : "READY_FOR_PAPER", "all_readiness_checks_passed", profile === "live" ? "Review the effective configuration before explicitly starting live trading." : "Start the paper profile; it will never load a wallet or submit a transaction.", common);
};

export const classifyDoctorError = (profile: ReferenceBotProfile, error: unknown): DoctorResult => {
  if (error instanceof StrykeSdkError) {
    const phase = typeof error.context?.phase === "string" ? error.context.phase : undefined;
    const waiting = error.code === "source_unavailable" || error.code === "source_stale" || (
      error.code === "quote_blocked" && !["market_minimum_unavailable", "configured_size_below_market_minimum", "paired_quote_mismatch"].includes(phase ?? "")
    );
    return result(profile, waiting ? "WAITING_FOR_MARKET" : "BLOCKED", phase ?? error.code, waiting ? "The setup is healthy but the required market data is temporarily unavailable; retry or keep paper mode running." : error.message);
  }
  return result(profile, "BLOCKED", "unexpected_error", error instanceof Error ? error.message : "Reference bot readiness failed");
};

export const doctorExitCode = (status: DoctorStatus): 0 | 1 | 2 => status === "BLOCKED" ? 1 : status === "WAITING_FOR_MARKET" ? 2 : 0;

export const emitDoctorResult = (value: DoctorResult): void => {
  console.log(JSON.stringify(value));
  process.exitCode = doctorExitCode(value.status);
};
