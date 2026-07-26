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
import { estimateFairProbability, type FairProbabilityInput } from "./strategy.js";

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
  }[];
};

export type PositionEvaluation = {
  market: PilotMarket;
  estimatorInput: FairProbabilityInput;
  sellQuote: ExecutableQuote;
  ifWinPayout: string;
  dataFresh: boolean;
};

export type EntryEvaluation = {
  market: PilotMarket;
  estimatorInput: FairProbabilityInput;
  buyQuotes: readonly [ExecutableQuote, ExecutableQuote];
  proposedSizeLamports: bigint;
  aggregateExposureLamports: bigint;
  openPositions: number;
  dataFresh: boolean;
};

export type RuntimeExecution = { clientActionId?: string; signature?: string };

export interface ReferenceBotRuntimeAdapter {
  loadCheckpoint(): Promise<ActionCheckpoint | undefined>;
  reconcilePending(checkpoint: ActionCheckpoint): Promise<{ state: string; clientActionId: string; signature?: string }>;
  listPositions(): Promise<PilotPosition[]>;
  evaluatePosition(position: PilotPosition, exposure: PilotPositionSideExposure): Promise<PositionEvaluation>;
  evaluateEntry(): Promise<EntryEvaluation>;
  executeBuy(evaluation: EntryEvaluation, quote: ExecutableQuote): Promise<RuntimeExecution>;
  executeSell(position: PilotPosition, exposure: PilotPositionSideExposure, evaluation: PositionEvaluation): Promise<RuntimeExecution>;
  executeTerminal(position: PilotPosition, action: PositionTerminalAction): Promise<RuntimeExecution>;
}

const terminalStates = new Set(["claimable", "refundable"]);
const completeStates = new Set(["lost", "claimed", "refunded", "sold", "expired_unclaimed"]);
const openStates = new Set(["open_position", "sellable"]);

const isTradingLockedError = (error: unknown): boolean =>
  error instanceof StrykeSdkError &&
  (error.context?.phase === "locked" ||
    /TradingLockedBeforeExpiry|locked before settlement|trading is locked/i.test(
      error.message
    ));

const event = (tick: number, phase: RuntimeEvent["phase"], action: RuntimeEvent["action"], reason: string, extra: Partial<RuntimeEvent> = {}): RuntimeEvent =>
  ({ tick, phase, action, reason, ...extra });

export const runMarketTick = async ({
  tick,
  config,
  adapter,
}: {
  tick: number;
  config: ReferenceBotConfig;
  adapter: ReferenceBotRuntimeAdapter;
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
      positionDecisions.push({
        positionId: position.positionId,
        action: isTradingLockedError(error) ? "hold" : "decision_unavailable",
        reason: isTradingLockedError(error) ? "trading_locked_until_settlement" : "position_evaluation_unavailable",
      });
      continue;
    }
    if (!evaluation.dataFresh) {
      positionDecisions.push({ positionId: position.positionId, action: "decision_unavailable", reason: "position_data_stale" });
      continue;
    }
    const fairProbability = estimateFairProbability(evaluation.estimatorInput, config.estimator, {
      lookbackSeconds: config.historyLookbackSeconds[config.expiryFamily], minimumHistoryCoverageBps: config.minimumHistoryCoverageBps,
      minimumVolatilityBpsPerSqrtHour: config.minimumVolatilityBpsPerSqrtHour, maximumVolatilityBpsPerSqrtHour: config.maximumVolatilityBpsPerSqrtHour,
      maximumModelProbabilityBps: config.maximumModelProbabilityBps,
    });
    const decision: PositionDecision = decidePositionExit({
      side: exposure.side, fairProbability, sellQuote: evaluation.sellQuote,
      shares: exposure.shares,
      ...(exposure.costBasisCollateralUnits === undefined ? {} : { costBasisCollateralUnits: exposure.costBasisCollateralUnits }),
      ifWinPayout: evaluation.ifWinPayout, stopLossBps: config.stopLossBps,
      takeProfitBps: config.takeProfitBps,
    });
    const details = { fairProbability, ...(decision.pnlBps === undefined ? {} : { pnlBps: decision.pnlBps.toString() }), ...(decision.sellNowValue === undefined ? {} : { sellNowValue: decision.sellNowValue.toString() }), ...(decision.holdValue === undefined ? {} : { holdValue: decision.holdValue.toString() }) };
    positionDecisions.push({ positionId: position.positionId, action: decision.action, reason: decision.reason });
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
    try { result = await adapter.executeSell(sell.position, sell.exposure, sell.evaluation); }
    catch (error) {
      if (isTradingLockedError(error)) return event(tick, "position", "hold", "trading_locked_until_settlement", { positionId: sell.position.positionId, marketId: sell.evaluation.market.marketId, details: sell.details, positionDecisions });
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
    throw error;
  }
  const fairProbability = estimateFairProbability(evaluation.estimatorInput, config.estimator, {
    lookbackSeconds: config.historyLookbackSeconds[config.expiryFamily], minimumHistoryCoverageBps: config.minimumHistoryCoverageBps,
    minimumVolatilityBpsPerSqrtHour: config.minimumVolatilityBpsPerSqrtHour, maximumVolatilityBpsPerSqrtHour: config.maximumVolatilityBpsPerSqrtHour,
    maximumModelProbabilityBps: config.maximumModelProbabilityBps,
  });
  const decision: BestEntryDecision = decideBestEntry({
    fairProbability, quotes: evaluation.buyQuotes, config,
    secondsRemaining: evaluation.estimatorInput.secondsRemaining,
    tradeSizeLamports: evaluation.proposedSizeLamports,
    aggregateExposureLamports: evaluation.aggregateExposureLamports,
    openPositions: evaluation.openPositions,
    dataFresh: evaluation.dataFresh,
  });
  const details = { fairProbability: decision.fairProbability, sideFairProbability: decision.sideFairProbability, quoteProbability: decision.quoteProbability, edgeBps: decision.edgeBps, effectiveFeeBps: decision.quote.closingProtection.effectiveFeeBps, selectedSide: decision.quote.side, proposedSize: evaluation.proposedSizeLamports.toString() };
  if (decision.action !== "buy") return event(tick, "entry", decision.action, decision.reason, { marketId: evaluation.market.marketId, details });
  let result: RuntimeExecution;
  try { result = await adapter.executeBuy(evaluation, decision.quote); }
  catch (error) {
    if (isTradingLockedError(error)) return event(tick, "entry", "blocked", "trading_locked_until_settlement", { marketId: evaluation.market.marketId, details });
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
export * from "./sdk-runtime.js";
export * from "./sizing.js";
export * from "./strategy.js";
export * from "./wallet.js";
