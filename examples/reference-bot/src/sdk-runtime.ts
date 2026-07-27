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
import type { PolymarketClient } from "./polymarket-client.js";
import type { RoundDecisionStore } from "./round-state.js";

export const positionCountsTowardEntryCapacity = (position: PilotPosition): boolean =>
  ["pending_confirmation", "open_position", "sellable", "awaiting_resolution"].includes(position.lifecycle.state);

const canonicalDecimalIdentity = (value: string): string => {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) return value;
  const integer = match[2]!.replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const magnitude = fraction ? `${integer}.${fraction}` : integer;
  return magnitude === "0" ? "0" : `${match[1] === "-" ? "-" : ""}${magnitude}`;
};

const sameTargetIdentity = (left: unknown, right: unknown): boolean =>
  typeof left === "string" && typeof right === "string" &&
  canonicalDecimalIdentity(left) === canonicalDecimalIdentity(right);

export const authoritativeActivationFor = (market: PilotMarket, configuredLimit: bigint) => {
  if (!market.activation) {
    throw new StrykeSdkError("compatibility", "Authoritative market activation state is unavailable");
  }
  if (
    BigInt(market.activation.yes.thresholdCollateralUnits) !== configuredLimit ||
    BigInt(market.activation.no.thresholdCollateralUnits) !== configuredLimit
  ) throw new StrykeSdkError("configuration", "Configured fee-free activation limit does not match the authoritative market policy");
  return market.activation;
};

const marketMatchesPosition = (market: PilotMarket, position: PilotPosition): boolean => {
  const identity = position.market;
  return identity.tokenMint === market.tokenMint && identity.expiryFamily === market.expiryFamily &&
    identity.expiryTs === market.expiryTs && sameTargetIdentity(identity.targetValue, market.strikePrice);
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
  polymarketClient,
  roundDecisionStore,
}: {
  client: StrykeClient;
  rpc: LatestBlockhashRpc;
  priceStore: PriceStore;
  checkpoint: ActionCheckpointStore;
  config: ReferenceBotConfig;
  owner?: string;
  executor?: ReviewedTransactionExecutor;
  now?: () => number;
  polymarketClient?: PolymarketClient;
  roundDecisionStore?: RoundDecisionStore;
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
    const identity = position.market as { expiryFamily?: unknown; expiryTs?: unknown; targetValue?: unknown };
    if (
      identity.expiryFamily !== config.expiryFamily ||
      typeof identity.expiryTs !== "number" ||
      typeof identity.targetValue !== "string"
    ) {
      throw new StrykeSdkError("position_state", "Position market identity is incomplete");
    }
    const market = await markets.byIdentity(config.asset, {
      expiryFamily: config.expiryFamily,
      expiryTs: identity.expiryTs,
      targetValue: identity.targetValue,
    });
    if (!marketMatchesPosition(market, position)) {
      throw new StrykeSdkError("position_state", "Position market identity did not match the API surface");
    }
    return market;
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
  const polymarketPrices = async (market: PilotMarket) => {
    if (config.estimator !== "polymarket_relative_value" || market.reference.alignmentStatus !== "aligned") return undefined;
    if (!polymarketClient || !market.reference.upTokenId || !market.reference.downTokenId) {
      throw new StrykeSdkError("source_unavailable", "Aligned Polymarket pricing configuration is unavailable", true);
    }
    const options = { timeoutMs: config.polymarketTimeoutMs, maximumAgeMs: config.polymarketMaximumPriceAgeMs, maximumSpreadBps: config.polymarketMaximumSpreadBps };
    const [yes, no] = await Promise.all([
      polymarketClient.executablePrice(market.reference.upTokenId, options),
      polymarketClient.executablePrice(market.reference.downTokenId, options),
    ]);
    return { yes, no } as const;
  };
  const saveMaterialization = async ({
    result,
    intentHash,
    action,
    market,
    positionId,
    sharesBefore,
    strategyReason,
  }: {
    result: Awaited<ReturnType<ReviewedTransactionExecutor["execute"]>>;
    intentHash: string;
    action: "buy" | "sell" | "claim" | "refund";
    market: { marketId?: string; expiryTs: number; targetValue: string };
    positionId?: string;
    sharesBefore?: string;
    strategyReason?: string;
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
        ...(market.marketId ? { marketId: market.marketId } : {}),
        ...(positionId ? { positionId } : {}),
        ...(sharesBefore ? { sharesBefore } : {}),
        ...(strategyReason ? { strategyReason } : {}),
      },
    });
  };
  const prepareAndExecute = async (
    market: PilotMarket,
    quote: Awaited<ReturnType<QuotesClient["get"]>>,
    materialization?: { positionId?: string; sharesBefore?: string; strategyReason?: string }
  ) => {
    const live = requireLive();
    const clientActionId = `pilot-${crypto.randomUUID()}`;
    const marketIdentity = { tokenMint: market.tokenMint, source: market.source, collateral: market.raw.collateral, expiryFamily: market.expiryFamily, expiryTs: market.expiryTs, targetValue: market.strikePrice };
    const intentHash = await createPilotIntentHash({ clientActionId, owner: live.owner, market: marketIdentity, quote });
    const result = await live.executor.execute(await transactions.prepare({ owner: live.owner, market, quote, clientActionId, intentHash }));
    await saveMaterialization({ result, intentHash, action: quote.action, market: { marketId: market.marketId, expiryTs: market.expiryTs, targetValue: market.strikePrice }, ...(materialization?.positionId ? { positionId: materialization.positionId } : {}), ...(materialization?.sharesBefore ? { sharesBefore: materialization.sharesBefore } : {}), ...(materialization?.strategyReason ? { strategyReason: materialization.strategyReason } : {}) });
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
          sameTargetIdentity(position.market.targetValue, materialization.targetValue)
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
        if (materialization.action === "sell" && materialization.strategyReason === "polymarket_convergence" && roundDecisionStore) {
          await roundDecisionStore.recordConvergenceExit({ marketId: materialization.marketId ?? String(matching?.market.tokenMint ?? materialization.targetValue), expiryTs: materialization.expiryTs, strikePrice: materialization.targetValue });
        }
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
      let externalPrices: Awaited<ReturnType<typeof polymarketPrices>>;
      let polymarketUnavailable = false;
      try { externalPrices = await polymarketPrices(market); }
      catch { polymarketUnavailable = true; }
      return { market, estimatorInput: estimatorInput(market), sellQuote: await quotes.sellAvailable({ market, side: exposure.side, ownedShares: exposure.shares, maximumSlippageBps: config.maximumPriceImpactBps }), ifWinPayout, dataFresh: !market.stale, ...(externalPrices ? { polymarketPrices: externalPrices } : {}), ...(polymarketUnavailable ? { polymarketUnavailable: true } : {}) };
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
      const activation = authoritativeActivationFor(market, config.feeFreeActivationLimitLamports);
      const yesActivation = activation.yes;
      const noActivation = activation.no;
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
      const externalPrices = await polymarketPrices(market);
      return { market, estimatorInput: estimatorInput(market), buyQuotes: [yesQuote, noQuote], proposedSizeLamports, aggregateExposureLamports, openPositions, dataFresh: !market.stale, ...(externalPrices ? { polymarketPrices: externalPrices } : {}) };
    },
    executeBuy: (evaluation, quote) => prepareAndExecute(evaluation.market, quote),
    executeSell: (position, exposure, evaluation, reason) => prepareAndExecute(evaluation.market, evaluation.sellQuote, { positionId: position.positionId, sharesBefore: exposure.shares, strategyReason: reason }),
    hasConvergenceExitedRound: (market) => roundDecisionStore?.hasConvergenceExit({ marketId: market.marketId, expiryTs: market.expiryTs, strikePrice: market.strikePrice }) ?? Promise.resolve(false),
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
