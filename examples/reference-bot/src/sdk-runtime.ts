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
import { calculateBufferedEntrySize } from "./sizing.js";

export const positionCountsTowardEntryCapacity = (position: PilotPosition): boolean =>
  ["pending_confirmation", "open_position", "sellable", "awaiting_resolution"].includes(position.lifecycle.state);

const marketMatchesPosition = (market: PilotMarket, position: PilotPosition): boolean => {
  const identity = position.market;
  return identity.tokenMint === market.tokenMint && identity.expiryFamily === market.expiryFamily &&
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
  const saveMaterialization = async ({
    result,
    intentHash,
    action,
    market,
    positionId,
    sharesBefore,
  }: {
    result: Awaited<ReturnType<ReviewedTransactionExecutor["execute"]>>;
    intentHash: string;
    action: "buy" | "sell" | "claim" | "refund";
    market: { expiryTs: number; targetValue: string };
    positionId?: string;
    sharesBefore?: string;
  }) => {
    if (result.state !== "confirmed") return;
    await checkpoint.save({
      clientActionId: result.clientActionId,
      intentHash,
      state: "confirmed",
      ...(result.signature ? { signature: result.signature } : {}),
      materialization: {
        action,
        asset: config.asset,
        expiryFamily: config.expiryFamily,
        expiryTs: market.expiryTs,
        targetValue: market.targetValue,
        ...(positionId ? { positionId } : {}),
        ...(sharesBefore ? { sharesBefore } : {}),
      },
    });
  };
  const prepareAndExecute = async (
    market: PilotMarket,
    quote: Awaited<ReturnType<QuotesClient["get"]>>,
    materialization?: { positionId?: string; sharesBefore?: string }
  ) => {
    const live = requireLive();
    const clientActionId = `pilot-${crypto.randomUUID()}`;
    const marketIdentity = { tokenMint: market.tokenMint, source: market.source, collateral: market.raw.collateral, expiryFamily: market.expiryFamily, expiryTs: market.expiryTs, targetValue: market.strikePrice };
    const intentHash = await createPilotIntentHash({ clientActionId, owner: live.owner, market: marketIdentity, quote });
    const result = await live.executor.execute(await transactions.prepare({ owner: live.owner, market, quote, clientActionId, intentHash }));
    await saveMaterialization({ result, intentHash, action: quote.action, market: { expiryTs: market.expiryTs, targetValue: market.strikePrice }, ...(materialization?.positionId ? { positionId: materialization.positionId } : {}), ...(materialization?.sharesBefore ? { sharesBefore: materialization.sharesBefore } : {}) });
    return executionResult(result);
  };
  return {
    loadCheckpoint: () => checkpoint.load(),
    reconcilePending: async (pending) => {
      if (pending.materialization) {
        const materialization = pending.materialization;
        const portfolio = owner ? await positions.list(owner) : [];
        const matching = portfolio.find((position) =>
          position.asset === materialization.asset &&
          position.market.expiryFamily === materialization.expiryFamily &&
          position.market.expiryTs === materialization.expiryTs &&
          position.market.targetValue === materialization.targetValue
        );
        const exposureShares = matching
          ? BigInt(matching.yesShares) + BigInt(matching.noShares)
          : 0n;
        const observed = materialization.action === "buy"
          ? exposureShares > 0n
          : materialization.action === "sell"
            ? !matching || !["open_position", "sellable"].includes(matching.lifecycle.state) || exposureShares < BigInt(materialization.sharesBefore ?? "0")
            : !matching || (
                exposureShares === 0n &&
                ["claimed", "refunded", "expired_unclaimed", "lost"].includes(matching.lifecycle.state)
              );
        if (!observed) return { state: "materializing", clientActionId: pending.clientActionId, ...(pending.signature ? { signature: pending.signature } : {}) };
        await checkpoint.clear(pending.clientActionId);
        return { state: "confirmed", clientActionId: pending.clientActionId, ...(pending.signature ? { signature: pending.signature } : {}) };
      }
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
    listPositions: async () => owner
      ? (await positions.list(owner)).filter((position) => position.asset === config.asset && position.market.expiryFamily === config.expiryFamily)
      : [],
    evaluatePosition: async (position, exposure) => {
      const market = await marketFor(position);
      const ifWinPayout = positionIfWinPayout(position, exposure);
      if (!ifWinPayout) throw new StrykeSdkError("position_state", "API-authored payout inputs are unavailable");
      return { market, estimatorInput: estimatorInput(market), sellQuote: await quotes.sell({ market, side: exposure.side, amount: exposure.shares, maximumSlippageBps: config.maximumPriceImpactBps }), ifWinPayout, dataFresh: !market.stale };
    },
    evaluateEntry: async () => {
      const market = await markets.current(
        config.asset,
        config.expiryFamily,
        priceStore.current(config.asset).price
      );
      const portfolio = owner ? await positions.list(owner) : [];
      const activePortfolio = portfolio.filter((position) =>
        position.asset === config.asset &&
        position.market.expiryFamily === config.expiryFamily &&
        positionCountsTowardEntryCapacity(position)
      );
      const aggregateExposureLamports = activePortfolio.reduce((sum, position) => sum + BigInt(position.yesCostBasisCollateralUnits ?? "0") + BigInt(position.noCostBasisCollateralUnits ?? "0"), 0n);
      const openPositions = activePortfolio.length;
      const yesActivation = market.activation.yes;
      const noActivation = market.activation.no;
      if (
        BigInt(yesActivation.thresholdCollateralUnits) !== config.feeFreeActivationLimitLamports ||
        BigInt(noActivation.thresholdCollateralUnits) !== config.feeFreeActivationLimitLamports
      ) throw new StrykeSdkError("configuration", "Configured fee-free activation limit does not match the authoritative market policy");
      const proposedSizeLamports = calculateBufferedEntrySize({
        configuredTradeSize: config.tradeSizeLamports, maximumTradeSize: config.maximumTradeSizeLamports,
        aggregateExposure: aggregateExposureLamports, maximumAggregateExposure: config.maximumAggregateExposureLamports,
        yesRealPool: BigInt(yesActivation.realPoolCollateralUnits), noRealPool: BigInt(noActivation.realPoolCollateralUnits),
        yesActivated: yesActivation.activated, noActivated: noActivation.activated,
        activationLimit: config.feeFreeActivationLimitLamports, activationBuffer: config.feeFreeBufferLamports,
      });
      if (proposedSizeLamports <= 0n) throw new StrykeSdkError("quote_blocked", "Buffered fee-free activation capacity is unavailable");
      const amount = proposedSizeLamports.toString();
      const [yesQuote, noQuote] = await Promise.all([
        quotes.buy({ market, side: "yes", amount, maximumSlippageBps: config.maximumPriceImpactBps }),
        quotes.buy({ market, side: "no", amount, maximumSlippageBps: config.maximumPriceImpactBps }),
      ]);
      return { market, estimatorInput: estimatorInput(market), buyQuotes: [yesQuote, noQuote], proposedSizeLamports, aggregateExposureLamports, openPositions, dataFresh: !market.stale };
    },
    executeBuy: (evaluation, quote) => prepareAndExecute(evaluation.market, quote),
    executeSell: (position, exposure, evaluation) => prepareAndExecute(evaluation.market, evaluation.sellQuote, { positionId: position.positionId, sharesBefore: exposure.shares }),
    executeTerminal: async (position, action) => {
      const live = requireLive();
      const clientActionId = `pilot-${crypto.randomUUID()}`;
      const intentHash = await createTerminalIntentHash({ clientActionId, owner: live.owner, market: position.market as Record<string, unknown>, action });
      const result = await live.executor.execute(await transactions.prepareTerminal({ owner: live.owner, position, action, clientActionId, intentHash }));
      await saveMaterialization({ result, intentHash, action, market: { expiryTs: Number(position.market.expiryTs), targetValue: String(position.market.targetValue) }, positionId: position.positionId });
      return executionResult(result);
    },
  };
};
