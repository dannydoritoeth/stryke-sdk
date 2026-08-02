import {
  positionSideExposures,
  terminalActionFor,
  type ActionCheckpoint,
  type ExecutableQuote,
  type PilotMarket,
  type PilotPosition,
  type PilotPositionSideExposure,
  type PositionTerminalAction,
  StrykeSdkError,
} from "@stryke/sdk";

import type { ReferenceBotConfig } from "./config.js";
import { decideBestEntry, type BestEntryDecision } from "./entry.js";
import { decidePositionExit, type PositionDecision } from "./manage-position.js";
import { estimateFairProbability, volatilityAdjustedProbabilities, type FairProbabilityInput } from "./strategy.js";
import type { PolymarketExecutablePrice } from "./polymarket-client.js";
import { selectEmptyMarketBootstrapEntry, selectExecutablePolymarketEntry } from "./strategy/polymarket-entry.js";
import { polymarketEntryWindow, type PolymarketTimingMode } from "./strategy/entry-window.js";
import { decidePolymarketEarlyExit } from "./strategy/polymarket-exit.js";

export type RuntimeAction = "buy" | "sell" | "claim" | "refund";

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
    action: "sell" | "hold" | "claim" | "refund" | "decision_unavailable";
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

export type RuntimeExecution = { clientActionId?: string; signature?: string };

export interface ReferenceBotRuntimeAdapter {
  loadCheckpoint(): Promise<ActionCheckpoint | undefined>;
  reconcilePending(checkpoint: ActionCheckpoint): Promise<{ state: string; clientActionId: string; signature?: string }>;
  listPositions(): Promise<PilotPosition[]>;
  evaluatePosition(position: PilotPosition, exposure: PilotPositionSideExposure): Promise<PositionEvaluation>;
  evaluateEntry(): Promise<EntryEvaluation>;
  executeBuy(evaluation: EntryEvaluation, quote: ExecutableQuote): Promise<RuntimeExecution>;
  executeSell(position: PilotPosition, exposure: PilotPositionSideExposure, evaluation: PositionEvaluation, reason: string): Promise<RuntimeExecution>;
  executeTerminal(position: PilotPosition, action: PositionTerminalAction): Promise<RuntimeExecution>;
  hasConvergenceExitedRound?(market: PilotMarket): Promise<boolean>;
  hasEnteredRound?(market: PilotMarket): Promise<boolean>;
  recordEnteredRound?(market: PilotMarket): Promise<void>;
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
  nowSeconds = Math.floor(Date.now() / 1_000),
}: {
  tick: number;
  config: ReferenceBotConfig;
  adapter: ReferenceBotRuntimeAdapter;
  nowSeconds?: number;
}): Promise<RuntimeEvent> => {
  const checkpoint = await adapter.loadCheckpoint();
  if (checkpoint) {
    const reconciled = await adapter.reconcilePending(checkpoint);
    if (reconciled.state === "submitted" || reconciled.state === "unknown" || reconciled.state === "not_submitted" || reconciled.state === "materializing") {
      return event(tick, "reconcile", "blocked", `pending_${reconciled.state}`, { clientActionId: reconciled.clientActionId, ...(reconciled.signature ? { signature: reconciled.signature } : {}) });
    }
    return event(tick, "reconcile", "complete", `reconciled_${reconciled.state}`, { clientActionId: reconciled.clientActionId, ...(reconciled.signature ? { signature: reconciled.signature } : {}) });
  }

  const positions = (await adapter.listPositions()).slice().sort((a, b) => a.positionId.localeCompare(b.positionId));
  const nonActionableTerminalPositions = new Set<string>();
  const terminalCandidates: Array<{ position: PilotPosition; action: PositionTerminalAction }> = [];
  const sellCandidates: Array<{
    position: PilotPosition;
    exposure: PilotPositionSideExposure;
    evaluation: PositionEvaluation;
    decision: PositionDecision;
    details: Record<string, string | number | boolean>;
  }> = [];
  const positionDecisions: Array<{
    positionId: string;
    action: "sell" | "hold" | "claim" | "refund" | "decision_unavailable";
    reason: string;
    details?: Readonly<Record<string, string | number | boolean>>;
  }> = [];
  for (const position of positions) {
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
    if (config.readOnlyMode || !config.liveTradingEnabled || config.killSwitchEnabled) {
      return event(tick, "position", terminal.action, "terminal_dry_run", { positionId: terminal.position.positionId, positionDecisions });
    }
    const result = await adapter.executeTerminal(terminal.position, terminal.action);
    return event(tick, "position", terminal.action, "terminal_confirmed", { positionId: terminal.position.positionId, positionDecisions, ...result });
  }

  sellCandidates.sort((a, b) => {
    const priority = (reason: string) => reason === "stop_loss" ? 0 : reason === "take_profit" ? 1 : 2;
    return priority(a.decision.reason) - priority(b.decision.reason) || a.position.positionId.localeCompare(b.position.positionId);
  });
  const sell = sellCandidates[0];
  if (sell) {
    if (config.readOnlyMode || !config.liveTradingEnabled || config.killSwitchEnabled) {
      return event(tick, "position", "sell", `${sell.decision.reason}_dry_run`, { positionId: sell.position.positionId, marketId: sell.evaluation.market.marketId, details: sell.details, positionDecisions });
    }
    let result: RuntimeExecution;
    try { result = await adapter.executeSell(sell.position, sell.exposure, sell.evaluation, sell.decision.reason); }
    catch (error) {
      if (isTradingLockedError(error)) return event(tick, "position", "hold", "trading_locked_until_settlement", { positionId: sell.position.positionId, marketId: sell.evaluation.market.marketId, details: sell.details, positionDecisions });
      if (isQuoteRevalidationError(error)) return event(tick, "position", "hold", "quote_changed_before_submission", { positionId: sell.position.positionId, marketId: sell.evaluation.market.marketId, details: sell.details, positionDecisions });
      throw error;
    }
    return event(tick, "position", "sell", sell.decision.reason, { positionId: sell.position.positionId, marketId: sell.evaluation.market.marketId, details: sell.details, positionDecisions, ...result });
  }

  if (positions.some((position) => !completeStates.has(position.lifecycle.state) && !nonActionableTerminalPositions.has(position.positionId))) {
    const locked = positionDecisions.find((decision) => decision.reason === "trading_locked_until_settlement");
    return locked
      ? event(tick, "position", "hold", locked.reason, { positionId: locked.positionId, positionDecisions })
      : event(tick, "wait", "hold", "position_not_economically_complete", { positionDecisions });
  }

  let evaluation: EntryEvaluation;
  try { evaluation = await adapter.evaluateEntry(); }
  catch (error) {
    if (isTradingLockedError(error)) return event(tick, "entry", "blocked", "trading_locked_until_settlement");
    if (isQuoteRevalidationError(error)) return event(tick, "entry", "blocked", "market_changed_during_quote");
    throw error;
  }
  if (isPolymarketStrategy(config)) {
    if (evaluation.market.reference.alignmentStatus !== "aligned" || !evaluation.polymarketPrices) {
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
      const nativeSafety = decideBestEntry({ fairProbability: bootstrap.side === "yes" ? 1 : 0, quotes: evaluation.buyQuotes, config: { ...config, minimumEntryEdgeBps: 0 }, secondsRemaining: evaluation.estimatorInput.secondsRemaining, tradeSizeLamports: evaluation.proposedSizeLamports, aggregateExposureLamports: evaluation.aggregateExposureLamports, openPositions: evaluation.openPositions, dataFresh: evaluation.dataFresh });
      const failedSafety = Object.entries(nativeSafety.safetyChecks).find(([key, passed]) => !passed && !["edge", "time", "feeFreeOpen"].includes(key));
      if (failedSafety) return event(tick, "entry", "blocked", failedSafety[0], { marketId: evaluation.market.marketId, details });
      if (config.readOnlyMode || !config.liveTradingEnabled) return event(tick, "entry", "dry_run", config.readOnlyMode ? "read_only" : "live_off", { marketId: evaluation.market.marketId, details });
      const result = await adapter.executeBuy(evaluation, bootstrap.quote);
      await adapter.recordEnteredRound?.(evaluation.market);
      return event(tick, "entry", "buy", bootstrap.reason, { marketId: evaluation.market.marketId, details, ...result });
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
    const nativeSafety = decideBestEntry({ fairProbability: relative.side === "yes" ? 1 : 0, quotes: evaluation.buyQuotes, config: { ...config, minimumEntryEdgeBps: 0 }, secondsRemaining: evaluation.estimatorInput.secondsRemaining, tradeSizeLamports: evaluation.proposedSizeLamports, aggregateExposureLamports: evaluation.aggregateExposureLamports, openPositions: evaluation.openPositions, dataFresh: evaluation.dataFresh });
    const failedSafety = Object.entries(nativeSafety.safetyChecks).find(([key, passed]) => !passed && !["edge", "time", "feeFreeOpen"].includes(key));
    if (failedSafety) return event(tick, "entry", "blocked", failedSafety[0], { marketId: evaluation.market.marketId, details });
    if (config.readOnlyMode || !config.liveTradingEnabled) return event(tick, "entry", "dry_run", config.readOnlyMode ? "read_only" : "live_off", { marketId: evaluation.market.marketId, details });
    const result = await adapter.executeBuy(evaluation, relative.quote);
    await adapter.recordEnteredRound?.(evaluation.market);
    return event(tick, "entry", "buy", relative.reason, { marketId: evaluation.market.marketId, details, ...result });
  }
  let model: ReturnType<typeof modelEvaluation>;
  try { model = modelEvaluation(evaluation.estimatorInput, config); }
  catch { return event(tick, "entry", "decision_unavailable", "model_inputs_unavailable", { marketId: evaluation.market.marketId }); }
  const fairProbability = model.fairProbability;
  const decision: BestEntryDecision = decideBestEntry({
    fairProbability, quotes: evaluation.buyQuotes, config,
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
  return event(tick, "entry", "buy", decision.reason, { marketId: evaluation.market.marketId, details, ...result });
};

export const runReferenceBot = async ({
  config,
  adapter,
  once = false,
  maximumTicks,
  signal,
  onEvent = (value: RuntimeEvent) => console.log(JSON.stringify(value)),
  wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
}: {
  config: ReferenceBotConfig;
  adapter: ReferenceBotRuntimeAdapter;
  once?: boolean;
  maximumTicks?: number;
  signal?: AbortSignal;
  onEvent?: (event: RuntimeEvent) => void;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<RuntimeEvent[]> => {
  const events: RuntimeEvent[] = [];
  for (let tick = 1; !signal?.aborted; tick += 1) {
    let result: RuntimeEvent;
    try {
      result = await runMarketTick({ tick, config, adapter });
    } catch (error) {
      if (!(error instanceof StrykeSdkError) || !error.retryable) throw error;
      result = event(tick, "wait", "blocked", `retryable_${error.code}`);
    }
    events.push(result);
    onEvent(result);
    if (once || signal?.aborted || tick === maximumTicks) break;
    await wait(config.tickIntervalMs);
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
export * from "./sdk-runtime.js";
export * from "./sizing.js";
export * from "./strategy.js";
export * from "./strategy/entry-window.js";
export * from "./strategy/polymarket-entry.js";
export * from "./wallet.js";
