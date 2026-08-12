import {
  positionSideExposures,
  positionCleanupAvailable,
  positionCleanupPending,
  terminalActionFor,
  type ActionCheckpoint,
  type ExecutableQuote,
  type PilotMarket,
  type PilotPosition,
  type PilotPositionSideExposure,
  type PositionTerminalAction,
  StrykeSdkError,
} from "@stryketrade/sdk";

import type { ReferenceBotConfig } from "./config.js";
import { decideBestEntry, type BestEntryDecision } from "./entry.js";
import { decidePositionExit, type PositionDecision } from "./manage-position.js";
import { estimateFairProbability, volatilityAdjustedProbabilities, type FairProbabilityInput } from "./strategy.js";
import type { PolymarketExecutablePrice } from "./polymarket-client.js";
import { selectEmptyMarketBootstrapEntry, selectExecutablePolymarketEntry } from "./strategy/polymarket-entry.js";
import { polymarketEntryWindow, type PolymarketTimingMode } from "./strategy/entry-window.js";
import { decidePolymarketEarlyExit } from "./strategy/polymarket-exit.js";
import { assertRuntimeLeaseHeld, type RuntimeLease } from "./runtime-lease.js";

export type RuntimeAction = "buy" | "sell" | "claim" | "refund" | "close" | "paper_buy" | "paper_hold" | "paper_sell" | "paper_claim" | "paper_refund" | "paper_loss";

export type RuntimeEvent = {
  tick: number;
  phase: "reconcile" | "position" | "entry" | "wait";
  action: RuntimeAction | "hold" | "skip" | "blocked" | "dry_run" | "decision_unavailable" | "complete";
  reason: string;
  positionId?: string;
  marketId?: string;
  clientActionId?: string;
  signature?: string;
  details?: Readonly<Record<string, string | number | boolean>>;
  positionDecisions?: readonly {
    positionId: string;
    action: "sell" | "hold" | "claim" | "refund" | "close" | "decision_unavailable";
    reason: string;
    details?: Readonly<Record<string, string | number | boolean>>;
  }[];
};

export type PositionEvaluation = {
  market: PilotMarket;
  estimatorInput: FairProbabilityInput;
  sellQuote: ExecutableQuote;
  ifWinPayout: string;
  dataFresh: boolean;
  polymarketPrices?: Readonly<Record<"yes" | "no", PolymarketExecutablePrice>>;
  polymarketUnavailable?: boolean;
};

export type EntryEvaluation = {
  market: PilotMarket;
  estimatorInput: FairProbabilityInput;
  buyQuotes: readonly [ExecutableQuote, ExecutableQuote];
  proposedSizeLamports: bigint;
  aggregateExposureLamports: bigint;
  openPositions: number;
  dataFresh: boolean;
  polymarketPrices?: Readonly<Record<"yes" | "no", PolymarketExecutablePrice>>;
};

export type RuntimeExecution = { clientActionId?: string; signature?: string; recoverableLamports?: string; estimatedNetworkFeeLamports?: string };

export interface ReferenceBotRuntimeAdapter {
  executionMode?: "paper" | "live";
  loadCheckpoint(): Promise<ActionCheckpoint | undefined>;
  reconcilePending(checkpoint: ActionCheckpoint): Promise<{ state: string; clientActionId: string; signature?: string }>;
  listPositions(): Promise<PilotPosition[]>;
  evaluatePosition(position: PilotPosition, exposure: PilotPositionSideExposure): Promise<PositionEvaluation>;
  evaluateEntry(): Promise<EntryEvaluation>;
  executeBuy(evaluation: EntryEvaluation, quote: ExecutableQuote): Promise<RuntimeExecution>;
  executeSell(position: PilotPosition, exposure: PilotPositionSideExposure, evaluation: PositionEvaluation, reason: string): Promise<RuntimeExecution>;
  executeTerminal(position: PilotPosition, action: PositionTerminalAction): Promise<RuntimeExecution>;
  executeCleanup?(position: PilotPosition): Promise<RuntimeExecution>;
  entryFundingStatus?(): Promise<{ available: boolean; balanceLamports: string; requiredLamports: string }>;
  hasConvergenceExitedRound?(market: PilotMarket): Promise<boolean>;
  hasEnteredRound?(market: PilotMarket): Promise<boolean>;
  recordEnteredRound?(market: PilotMarket): Promise<void>;
  loadMarketByIdentity?(identity: { expiryTs: number; strikePrice: string }): Promise<PilotMarket>;
  resolvePaperOutcome?(identity: { expiryTs: number; strikePrice: string }): Promise<"yes" | "no" | undefined>;
  acknowledgePaperLoss?(positionId: string): Promise<void>;
}

const terminalStates = new Set(["claimable", "refundable"]);
const completeStates = new Set(["lost", "claimed", "refunded", "sold", "expired_unclaimed"]);
const openStates = new Set(["open_position", "sellable"]);
const isPolymarketStrategy = (config: ReferenceBotConfig) => config.strategy.startsWith("polymarket_");
const polymarketMode = (config: ReferenceBotConfig): PolymarketTimingMode =>
  config.strategy === "polymarket_late" ? "polymarket_late" : "polymarket_early";

const isTradingLockedError = (error: unknown): boolean =>
  error instanceof StrykeSdkError &&
  (error.context?.phase === "locked" ||
    /TradingLockedBeforeExpiry|locked before settlement|trading is locked/i.test(
      error.message
    ));

const isQuoteRevalidationError = (error: unknown): boolean =>
  error instanceof StrykeSdkError && error.code === "quote_blocked";

const quoteBlockedPhase = (error: unknown): string | undefined =>
  error instanceof StrykeSdkError && error.code === "quote_blocked" && typeof error.context?.phase === "string"
    ? error.context.phase
    : undefined;

const positionMatchesMarket = (position: PilotPosition, market: PilotMarket): boolean => {
  const identity = position.market as Readonly<Record<string, unknown>>;
  return Number(identity.expiryTs) === market.expiryTs &&
    String(identity.targetValue) === market.strikePrice;
};

const event = (tick: number, phase: RuntimeEvent["phase"], action: RuntimeEvent["action"], reason: string, extra: Partial<RuntimeEvent> = {}): RuntimeEvent =>
  ({ tick, phase, action, reason, ...extra });

const modelEvaluation = (input: FairProbabilityInput, config: ReferenceBotConfig) => {
  const settings = {
    lookbackSeconds: config.historyLookbackSeconds[config.expiryFamily], minimumHistoryCoverageBps: config.minimumHistoryCoverageBps,
    minimumVolatilityBpsPerSqrtHour: config.minimumVolatilityBpsPerSqrtHour, maximumVolatilityBpsPerSqrtHour: config.maximumVolatilityBpsPerSqrtHour,
    maximumModelProbabilityBps: config.maximumModelProbabilityBps,
  };
  if (config.estimator === "volatility_adjusted_probability") {
    const result = volatilityAdjustedProbabilities(input, settings);
    return {
      fairProbability: result.yesProbability,
      diagnostics: {
        estimator: config.estimator, yesModelProbability: result.yesProbability, noModelProbability: result.noProbability,
        volatilityBpsPerSqrtHour: result.snapshot.volatilityBpsPerSqrtHour, lookbackSeconds: result.snapshot.lookbackSeconds,
        historyCoverageBps: result.snapshot.coverageBps, historyPointCount: result.snapshot.pointCount, secondsRemaining: input.secondsRemaining,
      },
    };
  }
  const fairProbability = estimateFairProbability(input, config.estimator, settings);
  return { fairProbability, diagnostics: { estimator: config.estimator, yesModelProbability: fairProbability, noModelProbability: 1 - fairProbability, secondsRemaining: input.secondsRemaining } };
};

export const runMarketTick = async ({
  tick,
  config,
  adapter,
  entryEnabled = true,
  nowSeconds = Math.floor(Date.now() / 1_000),
}: {
  tick: number;
  config: ReferenceBotConfig;
  adapter: ReferenceBotRuntimeAdapter;
  entryEnabled?: boolean;
  nowSeconds?: number;
}): Promise<RuntimeEvent> => {
  const paper = adapter.executionMode === "paper";
  const decisionConfig = paper ? { ...config, readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: false } : config;
  const checkpoint = await adapter.loadCheckpoint();
  if (checkpoint) {
    const reconciled = await adapter.reconcilePending(checkpoint);
    if (reconciled.state === "submitted" || reconciled.state === "unknown" || reconciled.state === "not_submitted" || reconciled.state === "materializing") {
      return event(tick, "reconcile", "blocked", `pending_${reconciled.state}`, { clientActionId: reconciled.clientActionId, ...(reconciled.signature ? { signature: reconciled.signature } : {}) });
    }
    return event(tick, "reconcile", "complete", `reconciled_${reconciled.state}`, { clientActionId: reconciled.clientActionId, ...(reconciled.signature ? { signature: reconciled.signature } : {}) });
  }

  const positions = (await adapter.listPositions()).slice().sort((a, b) => a.positionId.localeCompare(b.positionId));
  const pendingPaperLoss = paper && positions.find((position) => position.lifecycle.state === "lost" && position.raw.paperLossPending === true);
  if (pendingPaperLoss) {
    await adapter.acknowledgePaperLoss?.(pendingPaperLoss.positionId);
    return event(tick, "position", "paper_loss", "paper_terminal_simulated", { positionId: pendingPaperLoss.positionId });
  }
  const nonActionableTerminalPositions = new Set<string>();
  const terminalCandidates: Array<{ position: PilotPosition; action: PositionTerminalAction }> = [];
  const cleanupCandidates: PilotPosition[] = [];
  const cleanupWaiting: PilotPosition[] = [];
  const sellCandidates: Array<{
    position: PilotPosition;
    exposure: PilotPositionSideExposure;
    evaluation: PositionEvaluation;
    decision: PositionDecision;
    details: Record<string, string | number | boolean>;
  }> = [];
  const positionDecisions: Array<{
    positionId: string;
    action: "sell" | "hold" | "claim" | "refund" | "close" | "decision_unavailable";
    reason: string;
    details?: Readonly<Record<string, string | number | boolean>>;
  }> = [];
  for (const position of positions) {
    if (!paper && positionCleanupPending(position)) {
      if (positionCleanupAvailable(position, nowSeconds * 1_000)) {
        cleanupCandidates.push(position);
        positionDecisions.push({ positionId: position.positionId, action: "close", reason: "wallet_rent_recovery_available" });
      } else {
        cleanupWaiting.push(position);
        positionDecisions.push({
          positionId: position.positionId,
          action: "hold",
          reason: position.cleanup!.eligibilityStatus !== "eligible"
            ? "cleanup_awaiting_authoritative_eligibility"
            : "cleanup_not_yet_eligible",
          details: {
            ...(position.cleanup!.cleanupEligibleAt
              ? { cleanupEligibleAt: position.cleanup!.cleanupEligibleAt }
              : {}),
            cleanupEligibilityStatus: position.cleanup!.eligibilityStatus,
            ...(position.cleanup!.marketSettlementStatus
              ? { marketSettlementStatus: position.cleanup!.marketSettlementStatus }
              : {}),
            ...(position.cleanup!.blockedReason
              ? { blockedReason: position.cleanup!.blockedReason }
              : {}),
          },
        });
      }
      continue;
    }
    if (terminalStates.has(position.lifecycle.state)) {
      let action: PositionTerminalAction;
      try { action = terminalActionFor(position); }
      catch { nonActionableTerminalPositions.add(position.positionId); continue; }
      terminalCandidates.push({ position, action });
      positionDecisions.push({ positionId: position.positionId, action, reason: "authoritative_terminal_action" });
      continue;
    }
    if (!openStates.has(position.lifecycle.state)) continue;
    const exposures = positionSideExposures(position);
    if (exposures.length !== 1) {
      positionDecisions.push({ positionId: position.positionId, action: "decision_unavailable", reason: "position_side_ambiguous" });
      continue;
    }
    const exposure = exposures[0]!;
    let evaluation: PositionEvaluation;
    try { evaluation = await adapter.evaluatePosition(position, exposure); }
    catch (error) {
      const errorDetails = error instanceof StrykeSdkError
        ? { errorCode: error.code, errorMessage: error.message }
        : { errorCode: "unexpected", errorMessage: error instanceof Error ? error.message : "Unknown position evaluation error" };
      positionDecisions.push({
        positionId: position.positionId,
        action: isTradingLockedError(error) ? "hold" : "decision_unavailable",
        reason: isTradingLockedError(error) ? "trading_locked_until_settlement" : "position_evaluation_unavailable",
        details: errorDetails,
      });
      continue;
    }
    if (!evaluation.dataFresh) {
      positionDecisions.push({ positionId: position.positionId, action: "decision_unavailable", reason: "position_data_stale" });
      continue;
    }
    if (isPolymarketStrategy(config) && polymarketMode(config) === "polymarket_late") {
      positionDecisions.push({ positionId: position.positionId, action: "hold", reason: "strategy_holds_to_expiry" });
      continue;
    }
    if (isPolymarketStrategy(config)) {
      const result = decidePolymarketEarlyExit({
        policy: config.polymarketEarlyExitPolicy,
        side: exposure.side,
        sellQuote: evaluation.sellQuote,
        shares: evaluation.sellQuote.amount,
        ...(exposure.costBasisCollateralUnits === undefined ? {} : { costBasisCollateralUnits: exposure.costBasisCollateralUnits }),
        ifWinPayout: evaluation.ifWinPayout,
        stopLossBps: config.stopLossBps,
        takeProfitBps: config.takeProfitBps,
        ...(evaluation.polymarketPrices ? { prices: evaluation.polymarketPrices } : {}),
        exitEdgeBps: config.polymarketExitEdgeBps,
      });
      const details = { strategy: config.strategy, secondsRemaining: evaluation.estimatorInput.secondsRemaining, ...result.diagnostics, ...(result.decision.pnlBps === undefined ? {} : { pnlBps: result.decision.pnlBps.toString() }), ...(result.decision.sellNowValue === undefined ? {} : { sellNowValue: result.decision.sellNowValue.toString() }) };
      positionDecisions.push({ positionId: position.positionId, action: result.decision.action, reason: result.decision.reason, details });
      if (result.decision.action === "sell") sellCandidates.push({ position, exposure, evaluation, decision: result.decision, details });
      continue;
    }
    let model: { fairProbability: number; diagnostics: Record<string, string | number | boolean> };
    try { model = modelEvaluation(evaluation.estimatorInput, config); }
    catch { positionDecisions.push({ positionId: position.positionId, action: "decision_unavailable", reason: "model_inputs_unavailable" }); continue; }
    const decision: PositionDecision = decidePositionExit({
          side: exposure.side, fairProbability: model.fairProbability, sellQuote: evaluation.sellQuote,
          shares: evaluation.sellQuote.amount,
          ...(exposure.costBasisCollateralUnits === undefined ? {} : { costBasisCollateralUnits: exposure.costBasisCollateralUnits }),
          ifWinPayout: evaluation.ifWinPayout, stopLossBps: config.stopLossBps,
          takeProfitBps: config.takeProfitBps,
        });
    const details = { ...model.diagnostics, fairProbability: model.fairProbability, ...(decision.pnlBps === undefined ? {} : { pnlBps: decision.pnlBps.toString() }), ...(decision.sellNowValue === undefined ? {} : { sellNowValue: decision.sellNowValue.toString() }), ...(decision.holdValue === undefined ? {} : { holdValue: decision.holdValue.toString() }) };
    positionDecisions.push({ positionId: position.positionId, action: decision.action, reason: decision.reason, details });
    if (decision.action === "sell") sellCandidates.push({ position, exposure, evaluation, decision, details });
  }

  const terminal = terminalCandidates[0];
  if (terminal) {
    if (!paper && (config.readOnlyMode || !config.liveTradingEnabled || config.killSwitchEnabled)) {
      return event(tick, "position", terminal.action, "terminal_dry_run", { positionId: terminal.position.positionId, positionDecisions });
    }
    const result = await adapter.executeTerminal(terminal.position, terminal.action);
    return event(tick, "position", paper ? `paper_${terminal.action}` : terminal.action, paper ? "paper_terminal_simulated" : "terminal_confirmed", { positionId: terminal.position.positionId, positionDecisions, ...result });
  }

  const cleanup = cleanupCandidates[0];
  if (cleanup) {
    if (config.readOnlyMode || !config.liveTradingEnabled || config.killSwitchEnabled) {
      return event(tick, "position", "close", "cleanup_dry_run", {
        positionId: cleanup.positionId,
        positionDecisions,
      });
    }
    if (!adapter.executeCleanup) {
      return event(tick, "position", "blocked", "cleanup_adapter_unavailable", {
        positionId: cleanup.positionId,
        positionDecisions,
      });
    }
    const result = await adapter.executeCleanup(cleanup);
    return event(tick, "position", "close", "wallet_rent_recovered", {
      positionId: cleanup.positionId,
      details: {
        ...(result.recoverableLamports ? { recoverableLamports: result.recoverableLamports } : {}),
        ...(result.estimatedNetworkFeeLamports ? { estimatedNetworkFeeLamports: result.estimatedNetworkFeeLamports } : {}),
      },
      positionDecisions,
      ...result,
    });
  }

  const waitingCleanup = cleanupWaiting[0];
  if (waitingCleanup && !entryEnabled) {
    return event(tick, "wait", "hold", waitingCleanup.cleanup!.eligibilityStatus !== "eligible"
      ? "cleanup_awaiting_authoritative_eligibility"
      : "cleanup_not_yet_eligible", {
      positionId: waitingCleanup.positionId,
      details: {
        ...(waitingCleanup.cleanup!.cleanupEligibleAt
          ? { cleanupEligibleAt: waitingCleanup.cleanup!.cleanupEligibleAt }
          : {}),
        cleanupEligibilityStatus: waitingCleanup.cleanup!.eligibilityStatus,
        ...(waitingCleanup.cleanup!.marketSettlementStatus
          ? { marketSettlementStatus: waitingCleanup.cleanup!.marketSettlementStatus }
          : {}),
        ...(waitingCleanup.cleanup!.blockedReason
          ? { blockedReason: waitingCleanup.cleanup!.blockedReason }
          : {}),
      },
      positionDecisions,
    });
  }

  sellCandidates.sort((a, b) => {
    const priority = (reason: string) => reason === "stop_loss" ? 0 : reason === "take_profit" ? 1 : 2;
    return priority(a.decision.reason) - priority(b.decision.reason) || a.position.positionId.localeCompare(b.position.positionId);
  });
  const sell = sellCandidates[0];
  if (sell) {
    if (!paper && (config.readOnlyMode || !config.liveTradingEnabled || config.killSwitchEnabled)) {
      return event(tick, "position", "sell", `${sell.decision.reason}_dry_run`, { positionId: sell.position.positionId, marketId: sell.evaluation.market.marketId, details: sell.details, positionDecisions });
    }
    let result: RuntimeExecution;
    try { result = await adapter.executeSell(sell.position, sell.exposure, sell.evaluation, sell.decision.reason); }
    catch (error) {
      if (isTradingLockedError(error)) return event(tick, "position", "hold", "trading_locked_until_settlement", { positionId: sell.position.positionId, marketId: sell.evaluation.market.marketId, details: sell.details, positionDecisions });
      if (isQuoteRevalidationError(error)) return event(tick, "position", "hold", "quote_changed_before_submission", { positionId: sell.position.positionId, marketId: sell.evaluation.market.marketId, details: sell.details, positionDecisions });
      throw error;
    }
    return event(tick, "position", paper ? "paper_sell" : "sell", paper ? `${sell.decision.reason}_paper_simulated` : sell.decision.reason, { positionId: sell.position.positionId, marketId: sell.evaluation.market.marketId, details: sell.details, positionDecisions, ...result });
  }

  const awaitingPaper = paper && positions.find((position) => position.lifecycle.state === "awaiting_resolution");
  if (awaitingPaper) return event(tick, "position", "paper_hold", "paper_hold_to_expiry", { positionId: awaitingPaper.positionId, positionDecisions });

  if (!isPolymarketStrategy(config) && positions.some((position) => !completeStates.has(position.lifecycle.state) && !nonActionableTerminalPositions.has(position.positionId))) {
    const locked = positionDecisions.find((decision) => decision.reason === "trading_locked_until_settlement");
    return locked
      ? event(tick, "position", "hold", locked.reason, { positionId: locked.positionId, positionDecisions })
      : event(tick, "wait", "hold", "position_not_economically_complete", { positionDecisions });
  }

  if (!entryEnabled) {
    return event(tick, "entry", "skip", "entry_disabled_for_drain", {
      positionDecisions,
    });
  }

  const funding = await adapter.entryFundingStatus?.();
  if (funding && !funding.available) {
    return event(tick, "entry", "blocked", "insufficient_funding", {
      details: {
        balanceLamports: funding.balanceLamports,
        requiredLamports: funding.requiredLamports,
      },
    });
  }

  let evaluation: EntryEvaluation;
  try { evaluation = await adapter.evaluateEntry(); }
  catch (error) {
    if (isTradingLockedError(error)) return event(tick, "entry", "blocked", "trading_locked_until_settlement");
    if (isQuoteRevalidationError(error)) return event(tick, "entry", "blocked", quoteBlockedPhase(error) ?? "market_changed_during_quote");
    throw error;
  }
  if (isPolymarketStrategy(config)) {
    if (positions.some((position) => !completeStates.has(position.lifecycle.state) && positionMatchesMarket(position, evaluation.market))) {
      return event(tick, "wait", "hold", "position_not_economically_complete", { marketId: evaluation.market.marketId, positionDecisions });
    }
    if (evaluation.market.reference.alignmentStatus !== "aligned") {
      return event(tick, "entry", "skip", "reference_not_aligned", { marketId: evaluation.market.marketId });
    }
    if (await adapter.hasConvergenceExitedRound?.(evaluation.market)) {
      return event(tick, "entry", "skip", "same_round_reentry_blocked", { marketId: evaluation.market.marketId });
    }
    if (await adapter.hasEnteredRound?.(evaluation.market)) {
      return event(tick, "entry", "skip", "same_round_reentry_blocked", { marketId: evaluation.market.marketId });
    }
    const mode = polymarketMode(config);
    const window = polymarketEntryWindow({
      mode, market: evaluation.market, quote: evaluation.buyQuotes[0], now: nowSeconds,
      earlyWindowSeconds: config.polymarketEarlyWindowSeconds,
      lateWindowSeconds: config.polymarketLateWindowSeconds,
      submissionBufferSeconds: config.polymarketSubmissionBufferSeconds,
    });
    if (!window.eligible) return event(tick, "entry", "skip", window.reason, { marketId: evaluation.market.marketId, details: { mode, opensAt: window.opensAt, closesAt: window.closesAt, now: nowSeconds } });
    if (!evaluation.polymarketPrices) {
      return event(tick, "entry", "skip", "reference_not_aligned", { marketId: evaluation.market.marketId });
    }
    const exactEmptyMarket = evaluation.market.activation?.yes.realPoolCollateralUnits === "0"
      && evaluation.market.activation?.no.realPoolCollateralUnits === "0";
    const bootstrap = config.polymarketBootstrapEmptyMarket && exactEmptyMarket
      ? selectEmptyMarketBootstrapEntry({
          quotes: evaluation.buyQuotes,
          prices: evaluation.polymarketPrices,
          entryEdgeBps: config.polymarketEntryEdgeBps,
        })
      : undefined;
    if (bootstrap) {
      const details = {
        estimator: config.estimator, mode,
        selectedSide: bootstrap.side,
        entryEdgeBps: config.polymarketEntryEdgeBps,
        polymarketAskBps: bootstrap.referenceProbabilityBps,
        bootstrapReferenceEdgeBps: bootstrap.referenceEdgeBps,
        yesRealPool: "0", noRealPool: "0",
        entryWindowOpensAt: window.opensAt, entryWindowClosesAt: window.closesAt,
      };
      if (!bootstrap.passes) return event(tick, "entry", "skip", bootstrap.reason, { marketId: evaluation.market.marketId, details });
      const nativeSafety = decideBestEntry({ fairProbability: bootstrap.side === "yes" ? 1 : 0, quotes: evaluation.buyQuotes, config: { ...decisionConfig, minimumEntryEdgeBps: 0 }, secondsRemaining: evaluation.estimatorInput.secondsRemaining, tradeSizeLamports: evaluation.proposedSizeLamports, aggregateExposureLamports: evaluation.aggregateExposureLamports, openPositions: evaluation.openPositions, dataFresh: evaluation.dataFresh });
      const failedSafety = Object.entries(nativeSafety.safetyChecks).find(([key, passed]) => !passed && !["edge", "time", "feeFreeOpen"].includes(key));
      if (failedSafety) return event(tick, "entry", "blocked", failedSafety[0], { marketId: evaluation.market.marketId, details });
      if (!paper && (config.readOnlyMode || !config.liveTradingEnabled)) return event(tick, "entry", "dry_run", config.readOnlyMode ? "read_only" : "live_off", { marketId: evaluation.market.marketId, details });
      let result: RuntimeExecution;
      try { result = await adapter.executeBuy(evaluation, bootstrap.quote); }
      catch (error) {
        if (isTradingLockedError(error)) return event(tick, "entry", "blocked", "trading_locked_until_settlement", { marketId: evaluation.market.marketId, details });
        if (isQuoteRevalidationError(error)) return event(tick, "entry", "blocked", "quote_changed_before_submission", { marketId: evaluation.market.marketId, details });
        throw error;
      }
      await adapter.recordEnteredRound?.(evaluation.market);
      return event(tick, "entry", paper ? "paper_buy" : "buy", paper ? `${bootstrap.reason}_paper_simulated` : bootstrap.reason, { marketId: evaluation.market.marketId, details, ...result });
    }
    const relative = selectExecutablePolymarketEntry({
      quotes: evaluation.buyQuotes, prices: evaluation.polymarketPrices,
      entryEdgeBps: config.polymarketEntryEdgeBps,
      minimumHoldReturnBps: config.polymarketMinimumHoldReturnBps,
      minimumWinProfitBps: config.polymarketMinimumWinProfitBps,
    });
    const details = {
      estimator: config.estimator, mode,
      selectedSide: relative.side,
      edgeBps: relative.relativeEdgeBps,
      entryEdgeBps: config.polymarketEntryEdgeBps,
      costProbabilityBps: relative.costProbabilityBps,
      polymarketAskBps: relative.referenceProbabilityBps,
      projectedPayout: relative.projectedPayout.toString(), totalCost: relative.totalCost.toString(),
      profitIfWins: relative.profitIfWins.toString(), winProfitBps: relative.winProfitBps,
      holdExpectedValue: relative.holdExpectedValue.toString(), holdReturnBps: relative.holdReturnBps,
      entryWindowOpensAt: window.opensAt, entryWindowClosesAt: window.closesAt,
    };
    if (!relative.passes) return event(tick, "entry", "skip", relative.reason, { marketId: evaluation.market.marketId, details });
    const nativeSafety = decideBestEntry({ fairProbability: relative.side === "yes" ? 1 : 0, quotes: evaluation.buyQuotes, config: { ...decisionConfig, minimumEntryEdgeBps: 0 }, secondsRemaining: evaluation.estimatorInput.secondsRemaining, tradeSizeLamports: evaluation.proposedSizeLamports, aggregateExposureLamports: evaluation.aggregateExposureLamports, openPositions: evaluation.openPositions, dataFresh: evaluation.dataFresh });
    const failedSafety = Object.entries(nativeSafety.safetyChecks).find(([key, passed]) => !passed && !["edge", "time", "feeFreeOpen"].includes(key));
    if (failedSafety) return event(tick, "entry", "blocked", failedSafety[0], { marketId: evaluation.market.marketId, details });
    if (!paper && (config.readOnlyMode || !config.liveTradingEnabled)) return event(tick, "entry", "dry_run", config.readOnlyMode ? "read_only" : "live_off", { marketId: evaluation.market.marketId, details });
    let result: RuntimeExecution;
    try { result = await adapter.executeBuy(evaluation, relative.quote); }
    catch (error) {
      if (isTradingLockedError(error)) return event(tick, "entry", "blocked", "trading_locked_until_settlement", { marketId: evaluation.market.marketId, details });
      if (isQuoteRevalidationError(error)) return event(tick, "entry", "blocked", "quote_changed_before_submission", { marketId: evaluation.market.marketId, details });
      throw error;
    }
    await adapter.recordEnteredRound?.(evaluation.market);
    return event(tick, "entry", paper ? "paper_buy" : "buy", paper ? `${relative.reason}_paper_simulated` : relative.reason, { marketId: evaluation.market.marketId, details, ...result });
  }
  if (await adapter.hasEnteredRound?.(evaluation.market)) {
    return event(tick, "entry", "skip", "same_round_reentry_blocked", { marketId: evaluation.market.marketId });
  }
  let model: ReturnType<typeof modelEvaluation>;
  try { model = modelEvaluation(evaluation.estimatorInput, config); }
  catch { return event(tick, "entry", "decision_unavailable", "model_inputs_unavailable", { marketId: evaluation.market.marketId }); }
  const fairProbability = model.fairProbability;
  const decision: BestEntryDecision = decideBestEntry({
    fairProbability, quotes: evaluation.buyQuotes, config: decisionConfig,
    secondsRemaining: evaluation.estimatorInput.secondsRemaining,
    tradeSizeLamports: evaluation.proposedSizeLamports,
    aggregateExposureLamports: evaluation.aggregateExposureLamports,
    openPositions: evaluation.openPositions,
    dataFresh: evaluation.dataFresh,
  });
  const yesQuote = evaluation.buyQuotes.find((quote) => quote.side === "yes")!;
  const noQuote = evaluation.buyQuotes.find((quote) => quote.side === "no")!;
  const details = {
    ...model.diagnostics, fairProbability: decision.fairProbability, sideFairProbability: decision.sideFairProbability,
    quoteProbability: decision.quoteProbability, edgeBps: decision.edgeBps,
    yesNormalizedProbabilityBps: yesQuote.normalizedSideProbabilityBps, noNormalizedProbabilityBps: noQuote.normalizedSideProbabilityBps,
    yesEdgeBps: Math.round((fairProbability - yesQuote.normalizedSideProbabilityBps / 10_000) * 10_000),
    noEdgeBps: Math.round(((1 - fairProbability) - noQuote.normalizedSideProbabilityBps / 10_000) * 10_000),
    effectiveFeeBps: decision.quote.closingProtection.effectiveFeeBps, feeMode: decision.quote.feeBreakdown.feeMode,
    closingPhase: decision.quote.closingProtection.phase, selectedSide: decision.quote.side,
    proposedSize: evaluation.proposedSizeLamports.toString(),
    yesRealPool: evaluation.market.activation!.yes.realPoolCollateralUnits,
    noRealPool: evaluation.market.activation!.no.realPoolCollateralUnits,
  };
  if (decision.action !== "buy") return event(tick, "entry", decision.action, decision.reason, { marketId: evaluation.market.marketId, details });
  let result: RuntimeExecution;
  try { result = await adapter.executeBuy(evaluation, decision.quote); }
  catch (error) {
    if (isTradingLockedError(error)) return event(tick, "entry", "blocked", "trading_locked_until_settlement", { marketId: evaluation.market.marketId, details });
    if (isQuoteRevalidationError(error)) return event(tick, "entry", "blocked", "quote_changed_before_submission", { marketId: evaluation.market.marketId, details });
    throw error;
  }
  await adapter.recordEnteredRound?.(evaluation.market);
  return event(tick, "entry", paper ? "paper_buy" : "buy", paper ? `${decision.reason}_paper_simulated` : decision.reason, { marketId: evaluation.market.marketId, details, ...result });
};

export const runReferenceBot = async ({
  config,
  adapter,
  once = false,
  maximumTicks,
  signal,
  runtimeLease,
  entryEnabled = true,
  completeAfterConsecutiveIdleTicks,
  onEvent = (value: RuntimeEvent) => console.log(JSON.stringify(value)),
  wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
}: {
  config: ReferenceBotConfig;
  adapter: ReferenceBotRuntimeAdapter;
  once?: boolean;
  maximumTicks?: number;
  signal?: AbortSignal;
  runtimeLease?: RuntimeLease;
  entryEnabled?: boolean;
  completeAfterConsecutiveIdleTicks?: number;
  onEvent?: (event: RuntimeEvent) => void;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<RuntimeEvent[]> => {
  const events: RuntimeEvent[] = [];
  let consecutiveIdleTicks = 0;
  try {
    for (let tick = 1; !signal?.aborted; tick += 1) {
      if (runtimeLease) await assertRuntimeLeaseHeld(runtimeLease);
      let result: RuntimeEvent;
      try {
        result = await runMarketTick({ tick, config, adapter, entryEnabled });
      } catch (error) {
        if (!(error instanceof StrykeSdkError) || !error.retryable) throw error;
        result = event(tick, "wait", "blocked", `retryable_${error.code}`);
      }
      events.push(result);
      onEvent(result);
      consecutiveIdleTicks = result.reason === "entry_disabled_for_drain"
        ? consecutiveIdleTicks + 1
        : 0;
      if (
        completeAfterConsecutiveIdleTicks !== undefined &&
        consecutiveIdleTicks >= completeAfterConsecutiveIdleTicks
      ) break;
      if (once || signal?.aborted || tick === maximumTicks) break;
      await wait(config.tickIntervalMs);
    }
  } finally {
    if (runtimeLease) await runtimeLease.release();
  }
  return events;
};

export * from "./config.js";
export * from "./activation-policy.js";
export * from "./entry.js";
export * from "./logging.js";
export * from "./manage-position.js";
export * from "./polymarket-client.js";
export * from "./polymarket-relative-value.js";
export * from "./round-state.js";
export * from "./runtime-lease.js";
export * from "./postgres-state.js";
export * from "./sdk-runtime.js";
export * from "./sizing.js";
export * from "./strategy.js";
export * from "./strategy/entry-window.js";
export * from "./strategy/polymarket-entry.js";
export * from "./wallet.js";
