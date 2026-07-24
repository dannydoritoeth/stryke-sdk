import {
  MarketsClient,
  PositionsClient,
  QuotesClient,
  StrykeSdkError,
  TransactionsClient,
  createPilotIntentHash,
  createTerminalIntentHash,
  positionIfWinPayout,
  type ActionCheckpointStore,
  type LatestBlockhashRpc,
  type PilotMarket,
  type PilotPosition,
  type PilotPositionSideExposure,
  type PriceStore,
  type ReviewedTransactionExecutor,
  type StrykeClient,
} from "@stryke/sdk";

import type { ReferenceBotRuntimeAdapter, RuntimeExecution } from "./bot.js";
import type { ReferenceBotConfig } from "./config.js";

const marketMatchesPosition = (market: PilotMarket, position: PilotPosition): boolean => {
  const identity = position.market;
  return identity.tokenMint === market.assetRef && identity.expiryFamily === market.expiryFamily &&
    identity.expiryTs === market.expiryTs && identity.targetValue === market.strikePrice;
};

const executionResult = (value: unknown): RuntimeExecution => {
  const row = value as { clientActionId?: string; signature?: string };
  return { ...(row.clientActionId ? { clientActionId: row.clientActionId } : {}), ...(row.signature ? { signature: row.signature } : {}) };
};

export const createSdkRuntimeAdapter = ({
  client,
  rpc,
  priceStore,
  checkpoint,
  config,
  owner,
  executor,
  now = Date.now,
}: {
  client: StrykeClient;
  rpc: LatestBlockhashRpc;
  priceStore: PriceStore;
  checkpoint: ActionCheckpointStore;
  config: ReferenceBotConfig;
  owner?: string;
  executor?: ReviewedTransactionExecutor;
  now?: () => number;
}): ReferenceBotRuntimeAdapter => {
  const markets = new MarketsClient(client);
  const positions = new PositionsClient(client);
  const quotes = new QuotesClient(client, now);
  const transactions = new TransactionsClient(client, rpc, now);
  const requireLive = () => {
    if (!owner || !executor) throw new StrykeSdkError("configuration", "Live execution adapter is unavailable");
    return { owner, executor };
  };
  const marketFor = async (position: PilotPosition) => {
    const matches = (await markets.list(config.asset, config.expiryFamily)).filter((candidate) => marketMatchesPosition(candidate, position));
    if (matches.length !== 1) throw new StrykeSdkError("position_state", "Position market is unavailable or ambiguous");
    return matches[0]!;
  };
  const estimatorInput = (market: PilotMarket) => {
    const current = priceStore.current(config.asset);
    return {
      currentPrice: current.price,
      strikePrice: market.strikePriceDecimal,
      secondsRemaining: market.expiryTs - Math.floor(now() / 1_000),
      priceHistory: priceStore.history(config.asset).slice(-config.priceHistoryMaxPoints),
    };
  };
  const prepareAndExecute = async (market: PilotMarket, quote: Awaited<ReturnType<QuotesClient["get"]>>) => {
    const live = requireLive();
    const clientActionId = `pilot-${crypto.randomUUID()}`;
    const marketIdentity = { tokenMint: market.assetRef, source: market.source, collateral: market.raw.collateral, expiryFamily: market.expiryFamily, expiryTs: market.expiryTs, targetValue: market.strikePrice };
    const intentHash = await createPilotIntentHash({ clientActionId, owner: live.owner, market: marketIdentity, quote });
    return executionResult(await live.executor.execute(await transactions.prepare({ owner: live.owner, market, quote, clientActionId, intentHash })));
  };
  return {
    loadCheckpoint: () => checkpoint.load(),
    reconcilePending: async (pending) => {
      try {
        const result = await requireLive().executor.resume();
        return { state: result?.state ?? "not_submitted", clientActionId: pending.clientActionId, ...(result?.signature ? { signature: result.signature } : {}) };
      } catch (error) {
        if (error instanceof StrykeSdkError && error.code === "duplicate_action") {
          const current = await checkpoint.load();
          return { state: current?.state ?? "unknown", clientActionId: pending.clientActionId, ...(current?.signature ? { signature: current.signature } : {}) };
        }
        throw error;
      }
    },
    listPositions: () => owner ? positions.list(owner) : Promise.resolve([]),
    evaluatePosition: async (position, exposure) => {
      const market = await marketFor(position);
      const ifWinPayout = positionIfWinPayout(position, exposure);
      if (!ifWinPayout) throw new StrykeSdkError("position_state", "API-authored payout inputs are unavailable");
      return { market, estimatorInput: estimatorInput(market), sellQuote: await quotes.sell({ market, side: exposure.side, amount: exposure.shares, maximumSlippageBps: config.maximumPriceImpactBps }), ifWinPayout, dataFresh: !market.stale };
    },
    evaluateEntry: async () => {
      const market = await markets.current(config.asset, config.expiryFamily);
      const portfolio = owner ? await positions.list(owner) : [];
      const aggregateExposureLamports = portfolio.reduce((sum, position) => sum + BigInt(position.yesCostBasisCollateralUnits ?? "0") + BigInt(position.noCostBasisCollateralUnits ?? "0"), 0n);
      const openPositions = portfolio.filter((position) => ["open_position", "sellable", "awaiting_resolution", "claimable", "refundable"].includes(position.lifecycle.state)).length;
      return { market, estimatorInput: estimatorInput(market), buyQuote: await quotes.buy({ market, side: config.side, amount: config.tradeSizeLamports.toString(), maximumSlippageBps: config.maximumPriceImpactBps }), aggregateExposureLamports, openPositions, dataFresh: !market.stale };
    },
    executeBuy: (evaluation) => prepareAndExecute(evaluation.market, evaluation.buyQuote),
    executeSell: (_position, _exposure, evaluation) => prepareAndExecute(evaluation.market, evaluation.sellQuote),
    executeTerminal: async (position, action) => {
      const live = requireLive();
      const clientActionId = `pilot-${crypto.randomUUID()}`;
      const intentHash = await createTerminalIntentHash({ clientActionId, owner: live.owner, market: position.market as Record<string, unknown>, action });
      return executionResult(await live.executor.execute(await transactions.prepareTerminal({ owner: live.owner, position, action, clientActionId, intentHash })));
    },
  };
};
