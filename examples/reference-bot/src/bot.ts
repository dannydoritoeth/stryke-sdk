import {
  positionSideExposures,
  terminalActionFor,
  type ActionCheckpoint,
  type ExecutableQuote,
  type PilotMarket,
  type PilotPosition,
  type PilotPositionSideExposure,
  type PositionTerminalAction,
} from "@stryke/sdk";

import type { ReferenceBotConfig } from "./config.js";
import { decideEntry, type EntryDecision } from "./entry.js";
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
  buyQuote: ExecutableQuote;
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
  executeBuy(evaluation: EntryEvaluation): Promise<RuntimeExecution>;
  executeSell(position: PilotPosition, exposure: PilotPositionSideExposure, evaluation: PositionEvaluation): Promise<RuntimeExecution>;
  executeTerminal(position: PilotPosition, action: PositionTerminalAction): Promise<RuntimeExecution>;
}

const terminalStates = new Set(["claimable", "refundable"]);
const completeStates = new Set(["lost", "claimed", "refunded", "sold", "expired_unclaimed"]);
const openStates = new Set(["open_position", "sellable"]);

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
    if (reconciled.state === "submitted" || reconciled.state === "unknown" || reconciled.state === "not_submitted") {
      return event(tick, "reconcile", "blocked", `pending_${reconciled.state}`, { clientActionId: reconciled.clientActionId, ...(reconciled.signature ? { signature: reconciled.signature } : {}) });
    }
    return event(tick, "reconcile", "complete", `reconciled_${reconciled.state}`, { clientActionId: reconciled.clientActionId, ...(reconciled.signature ? { signature: reconciled.signature } : {}) });
  }

  const positions = (await adapter.listPositions()).slice().sort((a, b) => a.positionId.localeCompare(b.positionId));
  for (const position of positions) {
    if (terminalStates.has(position.lifecycle.state)) {
      let action: PositionTerminalAction;
      try { action = terminalActionFor(position); }
      catch { return event(tick, "position", "decision_unavailable", "authoritative_position_not_actionable", { positionId: position.positionId }); }
      if (config.readOnlyMode || !config.liveTradingEnabled || config.killSwitchEnabled) {
        return event(tick, "position", action, "terminal_dry_run", { positionId: position.positionId });
      }
      const result = await adapter.executeTerminal(position, action);
      return event(tick, "position", action, "terminal_confirmed", { positionId: position.positionId, ...result });
    }
    if (!openStates.has(position.lifecycle.state)) continue;
    const exposures = positionSideExposures(position);
    if (exposures.length !== 1) return event(tick, "position", "decision_unavailable", "position_side_ambiguous", { positionId: position.positionId });
    const exposure = exposures[0]!;
    let evaluation: PositionEvaluation;
    try { evaluation = await adapter.evaluatePosition(position, exposure); }
    catch { return event(tick, "position", "decision_unavailable", "position_evaluation_unavailable", { positionId: position.positionId }); }
    if (!evaluation.dataFresh) return event(tick, "position", "decision_unavailable", "position_data_stale", { positionId: position.positionId });
    const fairProbability = estimateFairProbability(evaluation.estimatorInput, config.estimator);
    const decision: PositionDecision = decidePositionExit({
      side: exposure.side, fairProbability, sellQuote: evaluation.sellQuote,
      shares: exposure.shares,
      ...(exposure.costBasisCollateralUnits === undefined ? {} : { costBasisCollateralUnits: exposure.costBasisCollateralUnits }),
      ifWinPayout: evaluation.ifWinPayout, stopLossBps: config.stopLossBps,
      takeProfitBps: config.takeProfitBps,
    });
    if (decision.action !== "sell") return event(tick, "position", decision.action, decision.reason, { positionId: position.positionId, marketId: evaluation.market.marketId });
    if (config.readOnlyMode || !config.liveTradingEnabled || config.killSwitchEnabled) return event(tick, "position", "sell", `${decision.reason}_dry_run`, { positionId: position.positionId, marketId: evaluation.market.marketId });
    const result = await adapter.executeSell(position, exposure, evaluation);
    return event(tick, "position", "sell", decision.reason, { positionId: position.positionId, marketId: evaluation.market.marketId, ...result });
  }

  if (positions.some((position) => !completeStates.has(position.lifecycle.state))) {
    return event(tick, "wait", "hold", "position_not_economically_complete");
  }

  const evaluation = await adapter.evaluateEntry();
  const fairProbability = estimateFairProbability(evaluation.estimatorInput, config.estimator);
  const decision: EntryDecision = decideEntry({
    fairProbability, quote: evaluation.buyQuote, config,
    secondsRemaining: evaluation.estimatorInput.secondsRemaining,
    tradeSizeLamports: config.tradeSizeLamports,
    aggregateExposureLamports: evaluation.aggregateExposureLamports,
    openPositions: evaluation.openPositions,
    dataFresh: evaluation.dataFresh,
  });
  if (decision.action !== "buy") return event(tick, "entry", decision.action, decision.reason, { marketId: evaluation.market.marketId });
  const result = await adapter.executeBuy(evaluation);
  return event(tick, "entry", "buy", decision.reason, { marketId: evaluation.market.marketId, ...result });
};

export const runReferenceBot = async ({
  config,
  adapter,
  once = false,
  signal,
  onEvent = (value: RuntimeEvent) => console.log(JSON.stringify(value)),
  wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
}: {
  config: ReferenceBotConfig;
  adapter: ReferenceBotRuntimeAdapter;
  once?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: RuntimeEvent) => void;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<RuntimeEvent[]> => {
  const events: RuntimeEvent[] = [];
  for (let tick = 1; !signal?.aborted; tick += 1) {
    const result = await runMarketTick({ tick, config, adapter });
    events.push(result);
    onEvent(result);
    if (once || signal?.aborted) break;
    await wait(config.tickIntervalMs);
  }
  return events;
};

export * from "./config.js";
export * from "./entry.js";
export * from "./logging.js";
export * from "./manage-position.js";
export * from "./sdk-runtime.js";
export * from "./strategy.js";
export * from "./wallet.js";
