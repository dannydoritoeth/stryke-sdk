import {
  CleanupClient,
  MarketsClient,
  PositionsClient,
  QuotesClient,
  StrykeSdkError,
  positionCleanupAvailable,
  TransactionsClient,
  createPilotIntentHash,
  createTerminalIntentHash,
  type ActionCheckpointStore,
  type LatestBlockhashRpc,
  type PilotMarket,
  type PilotPosition,
  type PilotPositionSideExposure,
  type PriceStore,
  type ReviewedTransactionExecutor,
  type SolanaReviewedExecutionAdapter,
  type StrykeClient,
} from "@stryketrade/sdk";

import type { ReferenceBotRuntimeAdapter, RuntimeExecution } from "./bot.js";
import type { ReferenceBotConfig } from "./config.js";
import { calculateBufferedEntrySize } from "./sizing.js";
import type { PolymarketClient } from "./polymarket-client.js";
import type { RoundDecisionStore } from "./round-state.js";
import { polymarketEntryWindow } from "./strategy/entry-window.js";

export const positionCountsTowardEntryCapacity = (position: PilotPosition): boolean =>
  ["pending_confirmation", "open_position", "sellable", "awaiting_resolution"].includes(position.lifecycle.state);

export const authoritativeMinimumForEntry = (
  market: PilotMarket,
  configuredTradeSizeLamports: bigint,
): bigint => {
  if (market.minimumTradeCollateralUnits === undefined || !/^\d+$/.test(market.minimumTradeCollateralUnits)) {
    throw new StrykeSdkError("quote_blocked", "Authoritative market minimum is unavailable", true, { phase: "market_minimum_unavailable", marketId: market.marketId });
  }
  const minimumTradeLamports = BigInt(market.minimumTradeCollateralUnits);
  if (configuredTradeSizeLamports < minimumTradeLamports) {
    throw new StrykeSdkError("quote_blocked", "Configured trade size is below the authoritative market minimum", false, {
      phase: "configured_size_below_market_minimum",
      marketId: market.marketId,
      configuredTradeSizeLamports: configuredTradeSizeLamports.toString(),
      minimumTradeLamports: minimumTradeLamports.toString(),
    });
  }
  return minimumTradeLamports;
};

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

export const shouldFetchPolymarketEntryPrices = ({
  config,
  market,
  quote,
  nowSeconds,
}: {
  config: ReferenceBotConfig;
  market: PilotMarket;
  quote: Awaited<ReturnType<QuotesClient["get"]>>;
  nowSeconds: number;
}): boolean => !config.strategy.startsWith("polymarket_") || polymarketEntryWindow({
  mode: config.strategy === "polymarket_late" ? "polymarket_late" : "polymarket_early",
  market,
  quote,
  now: nowSeconds,
  earlyWindowSeconds: config.polymarketEarlyWindowSeconds,
  lateWindowSeconds: config.polymarketLateWindowSeconds,
  submissionBufferSeconds: config.polymarketSubmissionBufferSeconds,
  ...(config.strategy === "polymarket_late" && config.polymarketPreFeeRevalidationEnabled
    ? { lateEntryCloseLeadSeconds: config.polymarketPreFeeRevalidationLeadSeconds }
    : {}),
}).eligible;

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

export const cleanupTransactionMatchesPosition = (
  transaction: Awaited<ReturnType<CleanupClient["prepareAll"]>>["transactions"][number],
  position: PilotPosition
): boolean => transaction.review.market.cleanupItems.some(({ market }) =>
  market.marketSeries === position.marketSeries &&
  market.strikeMarket === position.strikeMarket &&
  Number(market.expiryTs) === Number(position.market.expiryTs) &&
  sameTargetIdentity(market.targetValue, position.market.targetValue)
);

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
  cleanupExecutionAdapter,
  now = Date.now,
  polymarketClient,
  roundDecisionStore,
  entryFundingStatus,
}: {
  client: StrykeClient;
  rpc: LatestBlockhashRpc;
  priceStore: PriceStore;
  checkpoint: ActionCheckpointStore;
  config: ReferenceBotConfig;
  owner?: string;
  executor?: ReviewedTransactionExecutor;
  cleanupExecutionAdapter?: SolanaReviewedExecutionAdapter;
  now?: () => number;
  polymarketClient?: PolymarketClient;
  roundDecisionStore?: RoundDecisionStore;
  entryFundingStatus?: () => Promise<{ available: boolean; balanceLamports: string; requiredLamports: string }>;
}): ReferenceBotRuntimeAdapter => {
  const markets = new MarketsClient(client);
  const positions = new PositionsClient(client);
  const quotes = new QuotesClient(client, now);
  const transactions = new TransactionsClient(client, rpc, now);
  const cleanup = new CleanupClient(client, rpc);
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
    if (!config.strategy.startsWith("polymarket_") || market.reference.alignmentStatus !== "aligned") return undefined;
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
    ...(entryFundingStatus ? { entryFundingStatus } : {}),
    loadMarketByIdentity: (identity) => markets.byIdentity(config.asset, { expiryFamily: config.expiryFamily, expiryTs: identity.expiryTs, targetValue: identity.strikePrice }),
    resolvePaperOutcome: async (identity) => {
      const observations = priceStore.history(config.asset).slice().sort((left, right) => left.publishTime - right.publishTime);
      let previousPublishTime: number | undefined;
      for (const observation of observations) {
        if (previousPublishTime !== undefined && previousPublishTime < identity.expiryTs && identity.expiryTs <= observation.publishTime) {
          const target = Number(identity.strikePrice);
          if (!Number.isFinite(target)) throw new StrykeSdkError("validation", "Paper settlement target is invalid");
          return observation.price > target ? "yes" : "no";
        }
        previousPublishTime = observation.publishTime;
      }
      return undefined;
    },
    loadCheckpoint: () => checkpoint.load(),
    reconcilePending: async (pending) => {
      if (pending.materialization) {
        const materialization = pending.materialization;
        if (pending.state === "not_submitted" && !pending.signature) {
          await checkpoint.clear(pending.clientActionId);
          return { state: "not_submitted", clientActionId: pending.clientActionId };
        }
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
            : materialization.action === "close"
              ? !matching
            : !matching || (
                exposureShares === 0n &&
                ["claimed", "refunded", "expired_unclaimed", "lost"].includes(matching.lifecycle.state)
              );
        if (!observed && materialization.action === "close" && pending.signature && materialization.lastValidBlockHeight && cleanupExecutionAdapter) {
          const confirmation = await cleanupExecutionAdapter.confirm({
            signature: pending.signature,
            lastValidBlockHeight: BigInt(materialization.lastValidBlockHeight),
          });
          if (confirmation.state === "failed" || confirmation.state === "expired") {
            await checkpoint.clear(pending.clientActionId);
            return { state: confirmation.state, clientActionId: pending.clientActionId, signature: pending.signature };
          }
          return { state: confirmation.state === "confirmed" ? "materializing" : "submitted", clientActionId: pending.clientActionId, signature: pending.signature };
        }
        if (!observed) return { state: "materializing", clientActionId: pending.clientActionId, ...(pending.signature ? { signature: pending.signature } : {}) };
        if (materialization.action === "sell" && materialization.strategyReason === "polymarket_convergence" && roundDecisionStore) {
          await roundDecisionStore.recordConvergenceExit({ marketId: materialization.marketId ?? String(matching?.market.tokenMint ?? materialization.targetValue), expiryTs: materialization.expiryTs, strikePrice: materialization.targetValue });
        }
        if (materialization.action === "sell" && materialization.strategyReason === "polymarket_pre_fee_signal_changed" && materialization.positionId && roundDecisionStore) {
          await roundDecisionStore.recordPreFeeRevalidation({ marketId: materialization.marketId ?? String(matching?.market.tokenMint ?? materialization.targetValue), expiryTs: materialization.expiryTs, strikePrice: materialization.targetValue, positionId: materialization.positionId }, materialization.strategyReason);
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
      const ifWinPayout = exposure.winningPayoutCollateralUnits;
      if (!ifWinPayout) throw new StrykeSdkError("position_state", "API-authored payout inputs are unavailable");
      let externalPrices: Awaited<ReturnType<typeof polymarketPrices>>;
      let polymarketUnavailable = false;
      try { externalPrices = await polymarketPrices(market); }
      catch { polymarketUnavailable = true; }
      if (!owner) throw new StrykeSdkError("position_state", "Position owner is unavailable");
      return { market, estimatorInput: estimatorInput(market), sellQuote: await quotes.sellAvailable({ market, side: exposure.side, ownedShares: exposure.shares, maximumSlippageBps: config.maximumPriceImpactBps, owner }), ifWinPayout, dataFresh: !market.stale, ...(externalPrices ? { polymarketPrices: externalPrices } : {}), ...(polymarketUnavailable ? { polymarketUnavailable: true } : {}) };
    },
    evaluateEntry: async () => {
      const market = await markets.current(
        config.asset,
        config.expiryFamily,
        priceStore.current(config.asset).price
      );
      const minimumTradeLamports = authoritativeMinimumForEntry(market, config.tradeSizeLamports);
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
      if (proposedSizeLamports < minimumTradeLamports) {
        throw new StrykeSdkError("quote_blocked", "Available risk capacity is below the authoritative market minimum", false, {
          phase: "available_capacity_below_market_minimum",
          marketId: market.marketId,
          proposedSizeLamports: proposedSizeLamports.toString(),
          minimumTradeLamports: minimumTradeLamports.toString(),
        });
      }
      const amount = proposedSizeLamports.toString();
      const [yesQuote, noQuote] = await Promise.all([
        quotes.buy({ market, side: "yes", amount, maximumSlippageBps: config.maximumPriceImpactBps }),
        quotes.buy({ market, side: "no", amount, maximumSlippageBps: config.maximumPriceImpactBps }),
      ]);
      const shouldFetchPolymarket = shouldFetchPolymarketEntryPrices({
        config,
        market,
        quote: yesQuote,
        nowSeconds: Math.floor(now() / 1_000),
      });
      const externalPrices = shouldFetchPolymarket ? await polymarketPrices(market) : undefined;
      return { market, estimatorInput: estimatorInput(market), buyQuotes: [yesQuote, noQuote], proposedSizeLamports, minimumTradeLamports, aggregateExposureLamports, openPositions, dataFresh: !market.stale, ...(externalPrices ? { polymarketPrices: externalPrices } : {}) };
    },
    evaluatePreFeeRevalidation: async (_position, exposure, market) => {
      if (!owner) throw new StrykeSdkError("position_state", "Position owner is unavailable");
      if (!exposure.costBasisCollateralUnits || BigInt(exposure.costBasisCollateralUnits) <= 0n) throw new StrykeSdkError("position_state", "Original position sizing is unavailable");
      const amount = exposure.costBasisCollateralUnits;
      const [yesQuote, noQuote, externalPrices] = await Promise.all([
        quotes.buy({ market, side: "yes", amount, maximumSlippageBps: config.maximumPriceImpactBps }),
        quotes.buy({ market, side: "no", amount, maximumSlippageBps: config.maximumPriceImpactBps }),
        polymarketPrices(market),
      ]);
      if (!externalPrices) throw new StrykeSdkError("source_unavailable", "Polymarket pricing is unavailable", true);
      return { buyQuotes: [yesQuote, noQuote], polymarketPrices: externalPrices, dataFresh: !market.stale };
    },
    executeBuy: (evaluation, quote) => prepareAndExecute(evaluation.market, quote),
    executeSell: (position, exposure, evaluation, reason) => prepareAndExecute(evaluation.market, evaluation.sellQuote, { positionId: position.positionId, sharesBefore: exposure.shares, strategyReason: reason }),
    hasConvergenceExitedRound: (market) => roundDecisionStore?.hasConvergenceExit({ marketId: market.marketId, expiryTs: market.expiryTs, strikePrice: market.strikePrice }) ?? Promise.resolve(false),
    hasEnteredRound: (market) => roundDecisionStore?.hasEntry({ marketId: market.marketId, expiryTs: market.expiryTs, strikePrice: market.strikePrice }) ?? Promise.resolve(false),
    recordEnteredRound: (market) => roundDecisionStore?.recordEntry({ marketId: market.marketId, expiryTs: market.expiryTs, strikePrice: market.strikePrice }) ?? Promise.resolve(),
    hasPreFeeRevalidatedPosition: (market, positionId) => roundDecisionStore?.hasPreFeeRevalidation({ marketId: market.marketId, expiryTs: market.expiryTs, strikePrice: market.strikePrice, positionId }) ?? Promise.resolve(false),
    recordPreFeeRevalidatedPosition: (market, positionId, outcome) => roundDecisionStore?.recordPreFeeRevalidation({ marketId: market.marketId, expiryTs: market.expiryTs, strikePrice: market.strikePrice, positionId }, outcome) ?? Promise.resolve(),
    executeTerminal: async (position, action) => {
      const live = requireLive();
      const clientActionId = `pilot-${crypto.randomUUID()}`;
      const intentHash = await createTerminalIntentHash({ clientActionId, owner: live.owner, market: position.market as Record<string, unknown>, action });
      const result = await live.executor.execute(await transactions.prepareTerminal({ owner: live.owner, position, action, clientActionId, intentHash }));
      await saveMaterialization({ result, intentHash, action, market: { expiryTs: Number(position.market.expiryTs), targetValue: String(position.market.targetValue) }, positionId: position.positionId });
      return executionResult(result);
    },
    executeCleanup: async (position) => {
      const live = requireLive();
      if (!cleanupExecutionAdapter) {
        throw new StrykeSdkError("configuration", "Live cleanup execution adapter is unavailable");
      }
      if (!positionCleanupAvailable(position)) {
        throw new StrykeSdkError("position_state", "Position rent cleanup is unavailable");
      }
      const plan = await cleanup.prepareAll(live.owner);
      const prepared = plan.transactions.find((transaction) =>
        cleanupTransactionMatchesPosition(transaction, position)
      );
      if (!prepared) {
        throw new StrykeSdkError(
          "intent_mismatch",
          "No wallet-owned cleanup transaction matches the selected position"
        );
      }
      const materialization = {
        action: "close" as const,
        asset: config.asset,
        expiryFamily: config.expiryFamily,
        expiryTs: Number(position.market.expiryTs),
        targetValue: String(position.market.targetValue),
        positionId: position.positionId,
        lastValidBlockHeight: prepared.lastValidBlockHeight.toString(),
      };
      await checkpoint.save({
        clientActionId: prepared.clientActionId,
        intentHash: prepared.intentHash,
        state: "not_submitted",
        materialization,
      });
      let currentBlockHeight: bigint;
      try {
        currentBlockHeight = await cleanupExecutionAdapter.getBlockHeight();
      } catch {
        await checkpoint.clear(prepared.clientActionId);
        throw new StrykeSdkError("source_unavailable", "Cleanup block-height RPC check failed", true);
      }
      if (currentBlockHeight > prepared.lastValidBlockHeight) {
        await checkpoint.clear(prepared.clientActionId);
        throw new StrykeSdkError("blockhash_expired", "Prepared cleanup blockhash expired");
      }
      let simulation: Awaited<ReturnType<typeof cleanupExecutionAdapter.simulate>>;
      try {
        simulation = await cleanupExecutionAdapter.simulate(prepared);
      } catch {
        await checkpoint.clear(prepared.clientActionId);
        throw new StrykeSdkError("source_unavailable", "Cleanup simulation RPC request failed", true);
      }
      if (!simulation.ok) {
        await checkpoint.clear(prepared.clientActionId);
        throw new StrykeSdkError("simulation_failed", simulation.reason);
      }
      let signed: Uint8Array;
      try {
        signed = await cleanupExecutionAdapter.sign(prepared);
      } catch {
        await checkpoint.clear(prepared.clientActionId);
        throw new StrykeSdkError("wallet_rejected", "Wallet rejected cleanup signing");
      }
      const expectedSignature = cleanupExecutionAdapter.signatureFor(signed);
      await checkpoint.save({
        clientActionId: prepared.clientActionId,
        intentHash: prepared.intentHash,
        signature: expectedSignature,
        state: "unknown",
        materialization,
      });
      let signature: string;
      try {
        signature = await cleanupExecutionAdapter.submit(signed);
        if (signature !== expectedSignature) {
          throw new StrykeSdkError("intent_mismatch", "Submitted cleanup signature changed");
        }
      } catch {
        await checkpoint.save({
          clientActionId: prepared.clientActionId,
          intentHash: prepared.intentHash,
          signature: expectedSignature,
          state: "unknown",
          materialization,
        });
        throw new StrykeSdkError("submission_failed", "Cleanup submission outcome is unknown");
      }
      await checkpoint.save({
        clientActionId: prepared.clientActionId,
        intentHash: prepared.intentHash,
        signature,
        state: "submitted",
        materialization,
      });
      const confirmation = await cleanupExecutionAdapter.confirm({
        signature,
        lastValidBlockHeight: prepared.lastValidBlockHeight,
      });
      if (confirmation.state !== "confirmed") {
        if (confirmation.state === "failed" || confirmation.state === "expired") {
          await checkpoint.clear(prepared.clientActionId);
        }
        throw new StrykeSdkError(
          confirmation.state === "expired" ? "blockhash_expired" : "confirmation_unknown",
          `Cleanup confirmation ended in ${confirmation.state}`,
          confirmation.state === "unknown"
        );
      }
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const matching = (await positions.list(live.owner)).find((candidate) =>
          candidate.positionId === position.positionId
        );
        if (!matching) {
          await checkpoint.clear(prepared.clientActionId);
          return {
            clientActionId: prepared.clientActionId,
            signature,
            recoverableLamports: prepared.review.recoverableLamports,
            estimatedNetworkFeeLamports: prepared.review.estimatedNetworkFeeLamports,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new StrykeSdkError("source_stale", "Confirmed cleanup is awaiting portfolio refresh", true, {
        clientActionId: prepared.clientActionId,
      });
    },
  };
};
