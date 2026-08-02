import { describe, expect, it } from "vitest";
import { MemoryActionCheckpointStore, PYTH_FEED_IDS, PriceStore, SUPPORTED_PROGRAM_ID, SUPPORTED_QUOTE_MATH_VERSION } from "@stryke/sdk";

import { runMarketTick } from "../src/bot.js";
import { parseReferenceBotConfig } from "../src/config.js";
import { authoritativeActivationFor, createSdkRuntimeAdapter, positionCountsTowardEntryCapacity, shouldFetchPolymarketEntryPrices } from "../src/sdk-runtime.js";
import { quote } from "./fixtures.js";

describe("SDK runtime composition", () => {
  it("trading_requires_authoritative_activation_state_and_matching_policy", () => {
    expect(() => authoritativeActivationFor({} as never, 10_000n)).toThrowError(expect.objectContaining({ code: "compatibility" }));
    const market = { activation: {
      yes: { thresholdCollateralUnits: "10000" },
      no: { thresholdCollateralUnits: "10000" },
    } } as never;
    expect(authoritativeActivationFor(market, 10_000n)).toBe(market.activation);
    expect(() => authoritativeActivationFor(market, 9_999n)).toThrowError(expect.objectContaining({ code: "configuration" }));
  });
  it("non_actionable_terminal_history_does_not_consume_entry_capacity", () => {
    for (const state of ["claimable", "refundable", "lost", "claimed", "refunded"] as const) {
      expect(positionCountsTowardEntryCapacity({ lifecycle: { state } } as never)).toBe(false);
    }
    for (const state of ["pending_confirmation", "open_position", "sellable", "awaiting_resolution"] as const) {
      expect(positionCountsTowardEntryCapacity({ lifecycle: { state } } as never)).toBe(true);
    }
  });
  it("late_runtime_does_not_fetch_polymarket_books_before_entry_window_and_fetches_inside_it", () => {
    const config = parseReferenceBotConfig({
      strategy: "polymarket_late",
      polymarketEarlyExitPolicy: "hold_to_expiry",
      polymarketLateWindowSeconds: 20,
      polymarketSubmissionBufferSeconds: 3,
    });
    const closingStartsAt = 1_000;
    const market = { intervalStartTs: 700 } as never;
    const timingQuote = quote({
      closingProtection: { ...quote().closingProtection, closingStartsAt, hardLockTs: 1_005 },
    });
    expect(shouldFetchPolymarketEntryPrices({ config, market, quote: timingQuote, nowSeconds: 979 })).toBe(false);
    expect(shouldFetchPolymarketEntryPrices({ config, market, quote: timingQuote, nowSeconds: 980 })).toBe(true);
    expect(shouldFetchPolymarketEntryPrices({ config, market, quote: timingQuote, nowSeconds: 997 })).toBe(false);
  });
  it("actual_sdk_tick_consumes_market_side_size_slippage_estimator_and_risk_config", async () => {
    const now = Date.now();
    const config = parseReferenceBotConfig({
      asset: "SOL", expiryFamily: "one_minute", estimator: "distance_momentum",
      tradeSizeLamports: 1_234_567n, maximumTradeSizeLamports: 2_000_000n,
      maximumAggregateExposureLamports: 3_000_000n, minimumEntryEdgeBps: 9_999,
      maximumPriceImpactBps: 77, minimumSecondsToExpiry: 10, maximumOpenPositions: 1,
      tickIntervalMs: 1_234, stopLossBps: 321, takeProfitBps: 654,
      priceHistoryMaxPoints: 2, killSwitchEnabled: false,
    });
    const calls: Array<{ path: string; body?: Record<string, unknown> }> = [];
    const client = {
      requestJson: async (path: string, init?: RequestInit) => {
        calls.push({ path, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
        if (path.startsWith("/v1/markets?")) return {
          markets: [{
            marketId: "sol-1m", assetRef: "sol-feed", symbol: "SOL", source: "pyth_oracle",
            collateral: { symbol: "SOL", mint: "11111111111111111111111111111111" }, expiryFamily: "one_minute",
            expiryTs: Math.floor(now / 1_000) + 60,
            intervalStartTs: Math.floor(now / 1_000), intervalLifecycle: "active",
            targetValue: "10000000000", status: "open", rawStatus: "active",
            marketReference: {
              assetKey: "sol", expiryFamily: "one_minute",
              intervalStartTs: Math.floor(now / 1_000), intervalEndTs: Math.floor(now / 1_000) + 60,
              policy: "stryke_open", alignmentStatus: "native", status: "locked",
              targetValue: "10000000000", targetDecimals: 8, observedAt: new Date(now).toISOString(),
            },
            pilotLifecycle: { schemaVersion: "stryke.pilotLifecycle.v1", state: "open", rawStatus: "active", rawReason: "market_open", observedAt: new Date(now).toISOString() },
            tradeability: { canQuote: true, canPrepareTransaction: true, disabledReasons: [] },
            selectedMarket: {
              pools: { yesPool: "0 SOL", noPool: "0 SOL", stale: false },
              activation: {
                yes: { activated: false, thresholdCollateralUnits: "10000000000", realPoolCollateralUnits: "10", feeModeForNextBuy: "activation_waived", feeModeForNextSell: "activation_waived" },
                no: { activated: false, thresholdCollateralUnits: "10000000000", realPoolCollateralUnits: "10", feeModeForNextBuy: "activation_waived", feeModeForNextSell: "activation_waived" },
              },
              odds: { yesBps: 5000, noBps: 5000 },
            },
          }],
          metadata: { contractVersion: "stryke.botMarket.v1", generatedAt: new Date(now).toISOString(), stale: false },
        };
        return {
          quote: { quoteId: "quote-1", generatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30_000).toISOString(), marketStateVersion: "state-1", programId: SUPPORTED_PROGRAM_ID, mathVersion: SUPPORTED_QUOTE_MATH_VERSION, amount: "1234567", fee: "0", grossAmount: "1234567", feeAmount: "0", netAmount: "1234567", sharesOut: "1234567", averageExecutionPriceBps: "5000", postTradeSideReserve: "1234567", postTradeSideShares: "1234567", feeBreakdown: { feeMode: "waived", normalTradingFeeWaivedCollateralUnits: "0", grossTradeFeeCollateralUnits: "0", normalTradingFeeBps: 0, feeBpsApplied: 0 }, closingProtection: { policyVersion: 1, phase: "open", baseFeeBps: 0, closingFeeBps: 0, effectiveFeeBps: 0, closingStartsAt: Math.floor(now / 1_000) + 30, hardLockTs: Math.floor(now / 1_000) + 55, secondsUntilLock: 55 }, expectedShares: "1234567", minimumOutput: "1225060", maximumSlippageBpsApplied: 77, executionPriceBps: 5000, priceImpactBps: 1, economics: { economicVersion: 2, grossAmount: "1234567", tradeFee: "0", netPrincipalDelta: "1234567", participationUnitsDelta: "1234567", remainingPrincipal: "1234567", desiredCurveValue: "1234567", backedPremium: "0", surplusDelta: "0", executableCurrentValue: "1234567", projectedWinningPayout: "1234567", currentPnl: "0", profitIfWins: "0" } },
          metadata: { stale: false },
        };
      },
    };
    const store = new PriceStore({ now: () => now, maximumHistoryPoints: 2 });
    const id = PYTH_FEED_IDS.SOL.slice(2);
    for (const [price, publishTime] of [["9900000000", Math.floor(now / 1_000) - 1], ["10000000000", Math.floor(now / 1_000)]] as const) {
      store.ingest("SOL", { parsed: [{ id, price: { price, expo: -8, publish_time: publishTime } }] });
    }
    const adapter = createSdkRuntimeAdapter({ client: client as never, rpc: {} as never, priceStore: store, checkpoint: new MemoryActionCheckpointStore(), config, now: () => now });
    await expect(runMarketTick({ tick: 1, config, adapter })).resolves.toMatchObject({ phase: "entry", action: "skip", reason: "edge", marketId: "sol-1m" });
    expect(calls[0]!.path).toContain("symbol=SOL");
    expect(calls[0]!.path).toContain("expiryFamily=one_minute");
    expect(calls.slice(1, 3).map(({ body }) => body)).toEqual([
      expect.objectContaining({ action: "buy", side: "yes", amount: "1234567", maxSlippageBps: 77 }),
      expect.objectContaining({ action: "buy", side: "no", amount: "1234567", maxSlippageBps: 77 }),
    ]);
    const evaluation = await adapter.evaluateEntry();
    expect(evaluation.estimatorInput.priceHistory).toHaveLength(2);
    expect(config).toMatchObject({
      estimator: "distance_momentum", minimumEntryEdgeBps: 9_999,
      minimumSecondsToExpiry: 10, maximumOpenPositions: 1,
      maximumAggregateExposureLamports: 3_000_000n, stopLossBps: 321,
      takeProfitBps: 654, priceHistoryMaxPoints: 2,
    });
  });

  it("confirmed_buy_blocks_restart_until_portfolio_materializes", async () => {
    const checkpoint = new MemoryActionCheckpointStore();
    await checkpoint.save({
      clientActionId: "buy-1", intentHash: "intent-1", state: "confirmed", signature: "signature-1",
      materialization: { action: "buy", asset: "BTC", expiryFamily: "five_minute", expiryTs: 1_800_000_000, targetValue: "70000" },
    });
    let materialized = false;
    const client = { requestJson: async () => ({
      owner: "owner",
      positions: materialized ? [{
        owner: "owner", tokenSymbol: "BTC", tokenMint: "So11111111111111111111111111111111111111112",
        source: "pyth_oracle", collateral: { mint: "11111111111111111111111111111111" },
        expiryFamily: "five_minute", expiryTs: 1_800_000_000, targetValue: "70000.00000000",
        yesShares: "10", noShares: "0", yesCostBasisCollateralUnits: "7", economicVersion: 2,
        valuation: { costBasisCollateralUnits: "7", currentValueCollateralUnits: "8", currentPnlCollateralUnits: "1", winningPayoutCollateralUnits: "12", profitIfWinsCollateralUnits: "5", marketStateVersion: "state-1", generatedAt: new Date().toISOString(), stale: false },
        pilotLifecycle: { schemaVersion: "stryke.pilotLifecycle.v1", state: "sellable", rawStatus: "active", rawReason: "position_sellable", observedAt: new Date().toISOString() },
      }] : [],
      metadata: { stale: false, generatedAt: new Date().toISOString() },
    }) };
    const config = parseReferenceBotConfig({ asset: "BTC", expiryFamily: "five_minute" });
    const adapter = createSdkRuntimeAdapter({ client: client as never, rpc: {} as never, priceStore: new PriceStore(), checkpoint, config, owner: "owner" });
    const pending = (await checkpoint.load())!;
    await expect(adapter.reconcilePending(pending)).resolves.toMatchObject({ state: "materializing" });
    expect(await checkpoint.load()).toBeDefined();
    materialized = true;
    await expect(adapter.reconcilePending(pending)).resolves.toMatchObject({ state: "confirmed" });
    expect(await checkpoint.load()).toBeUndefined();
  });

  it("confirmed_terminal_action_clears_after_zero-share_complete_state", async () => {
    const checkpoint = new MemoryActionCheckpointStore();
    await checkpoint.save({ clientActionId: "claim-1", intentHash: "intent-1", state: "confirmed", materialization: { action: "claim", asset: "BTC", expiryFamily: "five_minute", expiryTs: 1_800_000_000, targetValue: "70000" } });
    const client = { requestJson: async () => ({ owner: "owner", positions: [{
      owner: "owner", tokenSymbol: "BTC", tokenMint: "So11111111111111111111111111111111111111112", source: "pyth_oracle", collateral: { mint: "11111111111111111111111111111111" }, expiryFamily: "five_minute", expiryTs: 1_800_000_000, targetValue: "70000", yesShares: "0", noShares: "0", pilotLifecycle: { schemaVersion: "stryke.pilotLifecycle.v1", state: "expired_unclaimed", rawStatus: "expired", rawReason: "position_expired", observedAt: new Date().toISOString() },
    }], metadata: { stale: false, generatedAt: new Date().toISOString() } }) };
    const config = parseReferenceBotConfig({ asset: "BTC", expiryFamily: "five_minute" });
    const adapter = createSdkRuntimeAdapter({ client: client as never, rpc: {} as never, priceStore: new PriceStore(), checkpoint, config, owner: "owner" });
    await expect(adapter.reconcilePending((await checkpoint.load())!)).resolves.toMatchObject({ state: "confirmed" });
    expect(await checkpoint.load()).toBeUndefined();
  });

  it("confirmed_convergence_sell_records_round_before_checkpoint_clear", async () => {
    const checkpoint = new MemoryActionCheckpointStore();
    await checkpoint.save({
      clientActionId: "sell-1", intentHash: "intent-1", state: "confirmed",
      materialization: { action: "sell", asset: "BTC", expiryFamily: "five_minute", marketId: "market-1", expiryTs: 1_800_000_000, targetValue: "70000", sharesBefore: "10", strategyReason: "polymarket_convergence" },
    });
    const recorded: unknown[] = [];
    const client = { requestJson: async () => ({ owner: "owner", positions: [], metadata: { stale: false, generatedAt: new Date().toISOString() } }) };
    const config = parseReferenceBotConfig({ asset: "BTC", expiryFamily: "five_minute" });
    const runtime = createSdkRuntimeAdapter({
      client: client as never, rpc: {} as never, priceStore: new PriceStore(), checkpoint, config, owner: "owner",
      roundDecisionStore: { hasConvergenceExit: async () => false, recordConvergenceExit: async (round) => { recorded.push(round); } },
    });
    await expect(runtime.reconcilePending((await checkpoint.load())!)).resolves.toMatchObject({ state: "confirmed" });
    expect(recorded).toEqual([{ marketId: "market-1", expiryTs: 1_800_000_000, strikePrice: "70000" }]);
    expect(await checkpoint.load()).toBeUndefined();
  });
});
