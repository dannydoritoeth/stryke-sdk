import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { StrykeSdkError, type ExecutableQuote, type PilotMarket, type PilotPosition, type PositionTerminalAction } from "@stryketrade/sdk";

import type { EntryEvaluation, ReferenceBotRuntimeAdapter, RuntimeExecution } from "./bot.js";

export const PAPER_LEDGER_SCHEMA_VERSION = "stryke.referenceBotPaperLedger.v1" as const;

type PaperPositionState = "open" | "claimed" | "refunded" | "loss_pending" | "lost" | "sold";

export type PaperPositionRecord = {
  positionId: string;
  marketId: string;
  asset: string;
  expiryFamily: string;
  expiryTs: number;
  strikePrice: string;
  side: "yes" | "no";
  shares: string;
  costBasisCollateralUnits: string;
  assumedWinningPayoutCollateralUnits: string;
  entryQuoteId: string;
  entryMarketStateVersion: string;
  enteredAt: string;
  state: PaperPositionState;
};

type PaperLedgerDocument = {
  schemaVersion: typeof PAPER_LEDGER_SCHEMA_VERSION;
  positions: PaperPositionRecord[];
};

const emptyLedger = (): PaperLedgerDocument => ({ schemaVersion: PAPER_LEDGER_SCHEMA_VERSION, positions: [] });

const validateRecord = (value: unknown): PaperPositionRecord => {
  const row = value as Partial<PaperPositionRecord>;
  if (
    !row || typeof row !== "object" ||
    typeof row.positionId !== "string" || typeof row.marketId !== "string" ||
    typeof row.asset !== "string" || typeof row.expiryFamily !== "string" ||
    !Number.isSafeInteger(row.expiryTs) || typeof row.strikePrice !== "string" ||
    !["yes", "no"].includes(row.side ?? "") ||
    !/^\d+$/.test(row.shares ?? "") || !/^\d+$/.test(row.costBasisCollateralUnits ?? "") ||
    !/^\d+$/.test(row.assumedWinningPayoutCollateralUnits ?? "") ||
    typeof row.entryQuoteId !== "string" || typeof row.entryMarketStateVersion !== "string" ||
    typeof row.enteredAt !== "string" || !Number.isFinite(Date.parse(row.enteredAt)) ||
    !["open", "claimed", "refunded", "loss_pending", "lost", "sold"].includes(row.state ?? "")
  ) throw new StrykeSdkError("configuration", "Paper ledger contains an unsupported record");
  return row as PaperPositionRecord;
};

export class FilePaperLedger {
  constructor(private readonly path: string) {}

  async load(): Promise<PaperLedgerDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as { schemaVersion?: unknown; positions?: unknown };
      if (parsed.schemaVersion !== PAPER_LEDGER_SCHEMA_VERSION || !Array.isArray(parsed.positions)) {
        throw new StrykeSdkError("configuration", "Paper ledger schema is unsupported");
      }
      return { schemaVersion: PAPER_LEDGER_SCHEMA_VERSION, positions: parsed.positions.map(validateRecord) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLedger();
      throw error;
    }
  }

  private async save(document: PaperLedgerDocument): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }

  async recordBuy(evaluation: EntryEvaluation, quote: ExecutableQuote): Promise<PaperPositionRecord> {
    if (!quote.expectedShares || !/^\d+$/.test(quote.expectedShares)) {
      throw new StrykeSdkError("validation", "Paper buy requires quote-authored expected shares");
    }
    const document = await this.load();
    const existing = document.positions.find((position) => position.marketId === evaluation.market.marketId && position.state === "open");
    if (existing) throw new StrykeSdkError("duplicate_action", "Paper position already exists for this market");
    const record: PaperPositionRecord = {
      positionId: `paper:${evaluation.market.marketId}:${quote.side}`,
      marketId: evaluation.market.marketId,
      asset: evaluation.market.asset,
      expiryFamily: evaluation.market.expiryFamily,
      expiryTs: evaluation.market.expiryTs,
      strikePrice: evaluation.market.strikePrice,
      side: quote.side,
      shares: quote.expectedShares,
      costBasisCollateralUnits: quote.grossAmount,
      assumedWinningPayoutCollateralUnits: quote.economics.projectedWinningPayout,
      entryQuoteId: quote.quoteId,
      entryMarketStateVersion: quote.marketStateVersion,
      enteredAt: new Date().toISOString(),
      state: "open",
    };
    document.positions.push(record);
    await this.save(document);
    return record;
  }

  async complete(positionId: string, state: Exclude<PaperPositionState, "open">): Promise<void> {
    const document = await this.load();
    const position = document.positions.find((candidate) => candidate.positionId === positionId && candidate.state === "open");
    if (!position) throw new StrykeSdkError("position_state", "Paper position is not open");
    position.state = state;
    await this.save(document);
  }

  async acknowledgeLoss(positionId: string): Promise<void> {
    const document = await this.load();
    const position = document.positions.find((candidate) => candidate.positionId === positionId && candidate.state === "loss_pending");
    if (!position) throw new StrykeSdkError("position_state", "Paper loss is not pending acknowledgement");
    position.state = "lost";
    await this.save(document);
  }
}

const lifecycle = (state: PilotPosition["lifecycle"]["state"], reason: string) => ({
  schemaVersion: "stryke.pilotLifecycle.v1" as const,
  state,
  rawStatus: `paper_${state}`,
  rawReason: reason,
  observedAt: new Date().toISOString(),
});

const paperPosition = (record: PaperPositionRecord, market?: PilotMarket, paperResolvedSide?: "yes" | "no"): PilotPosition => {
  const resolvedSide = market?.lifecycle.state === "resolved_yes" ? "yes" : market?.lifecycle.state === "resolved_no" ? "no" : paperResolvedSide;
  const refundable = market?.lifecycle.state === "refundable_underfunded" || market?.lifecycle.state === "refundable_zero_winner";
  const state = record.state === "claimed" ? "claimed" : record.state === "refunded" ? "refunded" : record.state === "sold" ? "sold" : record.state === "lost" || record.state === "loss_pending" ? "lost" : refundable ? "refundable" : resolvedSide ? (resolvedSide === record.side ? "claimable" : "lost") : "awaiting_resolution";
  const winning = state === "claimable";
  return {
    positionId: record.positionId,
    owner: "paper:no-wallet",
    asset: record.asset as "BTC" | "SOL",
    market: { tokenMint: market?.tokenMint, expiryFamily: record.expiryFamily, expiryTs: record.expiryTs, targetValue: record.strikePrice },
    yesShares: record.side === "yes" ? record.shares : "0",
    noShares: record.side === "no" ? record.shares : "0",
    actionDeadline: "9999-12-31T23:59:59.999Z",
    ...(record.side === "yes" ? { yesCostBasisCollateralUnits: record.costBasisCollateralUnits } : { noCostBasisCollateralUnits: record.costBasisCollateralUnits }),
    ...(winning ? { claimableAmount: record.assumedWinningPayoutCollateralUnits } : {}),
    ...(refundable ? { refundableAmount: record.costBasisCollateralUnits } : {}),
    lifecycle: lifecycle(state, state === "claimable" || state === "refundable" ? "paper_entry_quote_assumption" : `paper_${state}`),
    raw: { simulation: true, entryQuoteId: record.entryQuoteId, payoutAssumption: "entry_quote_projected_winning_payout", ...(record.state === "loss_pending" ? { paperLossPending: true } : {}) },
  };
};

export const createPaperRuntimeAdapter = (base: ReferenceBotRuntimeAdapter, ledger: FilePaperLedger): ReferenceBotRuntimeAdapter => ({
  ...base,
  executionMode: "paper",
  loadCheckpoint: async () => undefined,
  reconcilePending: async (checkpoint) => ({ state: "confirmed", clientActionId: checkpoint.clientActionId }),
  listPositions: async () => {
    const document = await ledger.load();
    return Promise.all(document.positions.map(async (record) => {
      let market: PilotMarket | undefined;
      let paperResolvedSide: "yes" | "no" | undefined;
      if (record.state === "open") {
        try { market = await base.loadMarketByIdentity?.({ expiryTs: record.expiryTs, strikePrice: record.strikePrice }); }
        catch { /* preserve durable awaiting state until authoritative data recovers */ }
        if (market && market.intervalLifecycle === "closed" && !["resolved_yes", "resolved_no"].includes(market.lifecycle.state)) {
          try { paperResolvedSide = await base.resolvePaperOutcome?.({ expiryTs: record.expiryTs, strikePrice: record.strikePrice }); }
          catch { /* preserve durable awaiting state until authoritative price evidence recovers */ }
        }
      }
      const position = paperPosition(record, market, paperResolvedSide);
      if (record.state === "open" && position.lifecycle.state === "lost") {
        await ledger.complete(record.positionId, "loss_pending");
        return paperPosition({ ...record, state: "loss_pending" }, market, paperResolvedSide);
      }
      return position;
    }));
  },
  evaluateEntry: async () => {
    const evaluation = await base.evaluateEntry();
    const active = (await ledger.load()).positions.filter((position) => position.state === "open");
    return {
      ...evaluation,
      aggregateExposureLamports: active.reduce((sum, position) => sum + BigInt(position.costBasisCollateralUnits), 0n),
      openPositions: active.length,
    };
  },
  executeBuy: async (evaluation, quote): Promise<RuntimeExecution> => {
    const record = await ledger.recordBuy(evaluation, quote);
    return { clientActionId: record.positionId };
  },
  executeSell: async (position): Promise<RuntimeExecution> => {
    await ledger.complete(position.positionId, "sold");
    return { clientActionId: `paper-sell:${position.positionId}` };
  },
  executeTerminal: async (position, action: PositionTerminalAction): Promise<RuntimeExecution> => {
    await ledger.complete(position.positionId, action === "claim" ? "claimed" : "refunded");
    return { clientActionId: `paper-${action}:${position.positionId}` };
  },
  acknowledgePaperLoss: (positionId) => ledger.acknowledgeLoss(positionId),
});
