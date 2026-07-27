import { describe, expect, it, vi } from "vitest";
import type { ActionCheckpoint, PilotPosition } from "@stryke/sdk";
import { StrykeSdkError } from "@stryke/sdk";

import { runMarketTick, runReferenceBot, type ReferenceBotRuntimeAdapter } from "../src/bot.js";
import { parseReferenceBotConfig } from "../src/config.js";
import { quote } from "./fixtures.js";

const history = [{ price: 99, publishTime: 1 }, { price: 100, publishTime: 2 }];
const market = {
  marketId: "market-1",
  pools: { yes: "10", no: "20", stale: false },
  activation: {
    yes: { realPoolCollateralUnits: "10" },
    no: { realPoolCollateralUnits: "20" },
  },
} as never;
const position = (state: PilotPosition["lifecycle"]["state"] = "sellable", overrides: Partial<PilotPosition> = {}): PilotPosition => ({
  positionId: "position-1", owner: "owner", market: {}, yesShares: "100", noShares: "0",
  yesCostBasisCollateralUnits: "100", lifecycle: { schemaVersion: "stryke.pilotLifecycle.v1", state, rawStatus: state, rawReason: state, observedAt: new Date().toISOString() }, raw: {}, ...overrides,
});
const live = parseReferenceBotConfig({ estimator: "distance_to_strike", readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: false });

const adapter = (overrides: Partial<ReferenceBotRuntimeAdapter> = {}): ReferenceBotRuntimeAdapter => ({
  loadCheckpoint: vi.fn(async () => undefined),
  reconcilePending: vi.fn(async (checkpoint: ActionCheckpoint) => ({ state: "confirmed", clientActionId: checkpoint.clientActionId })),
  listPositions: vi.fn(async () => []),
  evaluatePosition: vi.fn(async () => ({ market, estimatorInput: { currentPrice: 100, strikePrice: 100, secondsRemaining: 120, priceHistory: history }, sellQuote: quote({ action: "sell", side: "yes", amount: "100", expectedShares: undefined, expectedNetProceeds: "90", expiresAt: new Date(Date.now() + 60_000).toISOString() }), ifWinPayout: "200", dataFresh: true })),
  evaluateEntry: vi.fn(async () => ({ market, estimatorInput: { currentPrice: 101, strikePrice: 100, secondsRemaining: 120, priceHistory: history }, buyQuotes: [quote({ side: "yes", amount: live.tradeSizeLamports.toString(), executableProbabilityBps: 4000 }), quote({ side: "no", amount: live.tradeSizeLamports.toString(), executableProbabilityBps: 6000 })], proposedSizeLamports: live.tradeSizeLamports, aggregateExposureLamports: 0n, openPositions: 0, dataFresh: true })),
  executeBuy: vi.fn(async () => ({ clientActionId: "buy-1", signature: "buy-signature" })),
  executeSell: vi.fn(async () => ({ clientActionId: "sell-1", signature: "sell-signature" })),
  executeTerminal: vi.fn(async () => ({ clientActionId: "terminal-1", signature: "terminal-signature" })),
  ...overrides,
});

describe("reference bot composed runtime", () => {
  it("runtime_reconciles_before_manage_or_entry", async () => {
    const calls: string[] = [];
    const runtime = adapter({
      loadCheckpoint: async () => ({ clientActionId: "pending", intentHash: "intent", state: "submitted" }),
      reconcilePending: async () => { calls.push("reconcile"); return { state: "submitted", clientActionId: "pending" }; },
      listPositions: async () => { calls.push("positions"); return []; },
    });
    await expect(runMarketTick({ tick: 1, config: live, adapter: runtime })).resolves.toMatchObject({ phase: "reconcile", action: "blocked" });
    expect(calls).toEqual(["reconcile"]);
  });

  it("runtime_runs_two_ticks_and_does_not_duplicate_pending_action", async () => {
    let checkpoint: ActionCheckpoint | undefined;
    let buyCalls = 0;
    const runtime = adapter({
      loadCheckpoint: async () => checkpoint,
      executeBuy: async () => { buyCalls += 1; checkpoint = { clientActionId: "buy-1", intentHash: "intent", state: "submitted" }; return { clientActionId: "buy-1" }; },
      reconcilePending: async () => ({ state: "submitted", clientActionId: "buy-1" }),
    });
    const controller = new AbortController();
    let observed = 0;
    const events = await runReferenceBot({ config: live, adapter: runtime, wait: async () => {}, onEvent: () => { observed += 1; if (observed === 2) controller.abort(); }, signal: controller.signal });
    expect(events.slice(0, 2).map(({ action }) => action)).toEqual(["buy", "blocked"]);
    expect(buyCalls).toBe(1);
  });

  it("runtime_tick_interval_reaches_the_recurring_wait_consumer", async () => {
    const wait = vi.fn(async () => {});
    const config = parseReferenceBotConfig({ tickIntervalMs: 1_234, killSwitchEnabled: false });
    const events = await runReferenceBot({ config, adapter: adapter(), maximumTicks: 3, wait });
    expect(events).toHaveLength(3);
    expect(wait.mock.calls).toEqual([[1_234], [1_234]]);
  });

  it("runtime_open_position_holds_then_sells_from_fresh_executable_values", async () => {
    const open = position();
    let proceeds = "95";
    const runtime = adapter({
      listPositions: async () => [open],
      evaluatePosition: async (value, exposure) => ({ ...(await adapter().evaluatePosition(value, exposure)), sellQuote: quote({ action: "sell", side: "yes", amount: "100", expectedShares: undefined, expectedNetProceeds: proceeds, expiresAt: new Date(Date.now() + 60_000).toISOString() }), ifWinPayout: "200" }),
    });
    await expect(runMarketTick({ tick: 1, config: live, adapter: runtime })).resolves.toMatchObject({ action: "hold" });
    proceeds = "101";
    await expect(runMarketTick({ tick: 2, config: live, adapter: runtime })).resolves.toMatchObject({ action: "sell", reason: "sell_now_exceeds_probability_weighted_hold" });
  });

  it("all_open_positions_are_evaluated_before_entry", async () => {
    const first = position("sellable", { positionId: "position-a" });
    const second = position("sellable", { positionId: "position-b" });
    const evaluated: string[] = [];
    const runtime = adapter({
      listPositions: async () => [second, first],
      evaluatePosition: async (value, exposure) => {
        evaluated.push(value.positionId);
        return {
          ...(await adapter().evaluatePosition(value, exposure)),
          sellQuote: quote({ action: "sell", side: "yes", amount: "100", expectedShares: undefined, expectedNetProceeds: value.positionId === "position-b" ? "90" : "95", expiresAt: new Date(Date.now() + 60_000).toISOString() }),
        };
      },
    });
    const result = await runMarketTick({ tick: 1, config: live, adapter: runtime });
    expect(evaluated).toEqual(["position-a", "position-b"]);
    expect(result).toMatchObject({ action: "sell", reason: "stop_loss", positionId: "position-b" });
    expect(result.positionDecisions).toHaveLength(2);
    expect(runtime.executeSell).toHaveBeenCalledTimes(1);
    expect(runtime.evaluateEntry).not.toHaveBeenCalled();
  });

  it("one_hold_does_not_starve_later_stop_loss_over_two_ticks", async () => {
    const first = position("sellable", { positionId: "position-a" });
    const second = position("sellable", { positionId: "position-b" });
    const counts = new Map<string, number>();
    const runtime = adapter({
      listPositions: async () => [first, second],
      evaluatePosition: async (value, exposure) => {
        counts.set(value.positionId, (counts.get(value.positionId) ?? 0) + 1);
        return {
          ...(await adapter().evaluatePosition(value, exposure)),
          sellQuote: quote({ action: "sell", side: "yes", amount: "100", expectedShares: undefined, expectedNetProceeds: value.positionId === "position-a" ? "95" : "90", expiresAt: new Date(Date.now() + 60_000).toISOString() }),
        };
      },
    });
    await runReferenceBot({ config: { ...live, readOnlyMode: true }, adapter: runtime, maximumTicks: 2, wait: async () => {} });
    expect(Object.fromEntries(counts)).toEqual({ "position-a": 2, "position-b": 2 });
    expect(runtime.executeSell).not.toHaveBeenCalled();
  });

  it("runtime_stop_loss_and_take_profit_execute_full_position_sell", async () => {
    for (const [proceeds, reason] of [["90", "stop_loss"], ["120", "take_profit"]] as const) {
      const runtime = adapter({ listPositions: async () => [position()], evaluatePosition: async (value, exposure) => ({ ...(await adapter().evaluatePosition(value, exposure)), sellQuote: quote({ action: "sell", side: "yes", amount: "100", expectedShares: undefined, expectedNetProceeds: proceeds, expiresAt: new Date(Date.now() + 60_000).toISOString() }) }) });
      await expect(runMarketTick({ tick: 1, config: live, adapter: runtime })).resolves.toMatchObject({ action: "sell", reason });
      expect(runtime.executeSell).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ shares: "100" }), expect.objectContaining({ sellQuote: expect.objectContaining({ amount: "100" }) }), reason);
    }
  });

  it("runtime_waits_for_resolution_then_claims_or_refunds", async () => {
    const waiting = adapter({ listPositions: async () => [position("awaiting_resolution")] });
    await expect(runMarketTick({ tick: 1, config: live, adapter: waiting })).resolves.toMatchObject({ phase: "wait", reason: "position_not_economically_complete" });
    for (const [state, amount, action] of [["claimable", { claimableAmount: "10" }, "claim"], ["refundable", { refundableAmount: "10", lifecycle: { ...position("refundable").lifecycle, rawReason: "underfunded" } }, "refund"]] as const) {
      const runtime = adapter({ listPositions: async () => [position(state, { ...amount, actionDeadline: new Date(Date.now() + 60_000).toISOString() })] });
      await expect(runMarketTick({ tick: 2, config: live, adapter: runtime })).resolves.toMatchObject({ action });
    }
  });

  it("runtime_terminal_completion_allows_next_market_entry", async () => {
    const runtime = adapter({ listPositions: async () => [position("claimed")] });
    await expect(runMarketTick({ tick: 1, config: live, adapter: runtime })).resolves.toMatchObject({ phase: "entry", action: "buy" });
  });

  it("runtime_skips_non_actionable_historical_terminal_position_and_evaluates_entry", async () => {
    const stale = position("claimable", { claimableAmount: undefined, refundableAmount: undefined });
    const runtime = adapter({ listPositions: async () => [stale] });
    await expect(runMarketTick({ tick: 1, config: parseReferenceBotConfig({ killSwitchEnabled: false }), adapter: runtime })).resolves.toMatchObject({ phase: "entry" });
  });

  it("runtime_read_only_uses_real_sdk_tick_without_wallet_or_submission", async () => {
    const runtime = adapter();
    await expect(runMarketTick({ tick: 1, config: parseReferenceBotConfig({ estimator: "distance_to_strike", killSwitchEnabled: false }), adapter: runtime })).resolves.toMatchObject({ action: "dry_run", reason: "read_only" });
    expect(runtime.executeBuy).not.toHaveBeenCalled();
  });

  it("runtime_reports_retryable_unavailability_and_continues_next_tick", async () => {
    const controller = new AbortController();
    let calls = 0;
    const runtime = adapter({ evaluateEntry: async () => { calls += 1; if (calls === 1) throw new StrykeSdkError("source_unavailable", "rolling market unavailable", true); return adapter().evaluateEntry(); } });
    const events = await runReferenceBot({ config: parseReferenceBotConfig({ estimator: "distance_to_strike", killSwitchEnabled: false }), adapter: runtime, wait: async () => {}, onEvent: () => { if (calls === 2) controller.abort(); }, signal: controller.signal });
    expect(events.map(({ reason }) => reason)).toEqual(["retryable_source_unavailable", "read_only"]);
  });

  it("closing_fee_reaches_strategy_final_decision", async () => {
    const runtime = adapter({
      evaluateEntry: async () => ({
        ...(await adapter().evaluateEntry()),
        buyQuotes: [quote({
          closingProtection: {
            policyVersion: 1,
            phase: "closing",
            baseFeeBps: 100,
            closingFeeBps: 700,
            effectiveFeeBps: 700,
            hardLockTs: 1_800_000_000,
            secondsUntilLock: 8,
          },
        }), quote({ side: "no", amount: live.tradeSizeLamports.toString(), executableProbabilityBps: 6000 })],
        proposedSizeLamports: live.tradeSizeLamports,
      }),
    });

    await expect(runMarketTick({ tick: 1, config: { ...live, minimumEntryEdgeBps: 0 }, adapter: runtime })).resolves.toMatchObject({
      action: "blocked",
      details: { effectiveFeeBps: 700 },
    });
  });

  it("locked_entry_and_sell_are_suppressed", async () => {
    const locked = () =>
      new StrykeSdkError(
        "quote_blocked",
        "Trading is locked before settlement.",
        false,
        { phase: "locked", policyVersion: 1 }
      );
    const entryRuntime = adapter({ evaluateEntry: async () => { throw locked(); } });
    await expect(runMarketTick({ tick: 1, config: live, adapter: entryRuntime })).resolves.toMatchObject({
      action: "blocked", reason: "trading_locked_until_settlement",
    });
    expect(entryRuntime.executeBuy).not.toHaveBeenCalled();

    const sellRuntime = adapter({
      listPositions: async () => [position()],
      evaluatePosition: async () => { throw locked(); },
    });
    await expect(runMarketTick({ tick: 1, config: live, adapter: sellRuntime })).resolves.toMatchObject({
      action: "hold", reason: "trading_locked_until_settlement",
    });
    expect(sellRuntime.executeSell).not.toHaveBeenCalled();
  });

  it("quote_revalidation_races_are_contained_and_retried_on_a_later_tick", async () => {
    const changed = new StrykeSdkError("quote_blocked", "Pilot quote market state or minimum output changed before preparation");
    const evaluationRuntime = adapter({ evaluateEntry: async () => { throw changed; } });
    await expect(runMarketTick({ tick: 1, config: live, adapter: evaluationRuntime })).resolves.toMatchObject({
      phase: "entry", action: "blocked", reason: "market_changed_during_quote",
    });
    const entryRuntime = adapter({ executeBuy: async () => { throw changed; } });
    await expect(runMarketTick({ tick: 1, config: live, adapter: entryRuntime })).resolves.toMatchObject({
      phase: "entry", action: "blocked", reason: "quote_changed_before_submission",
    });

    const sellRuntime = adapter({
      listPositions: async () => [position()],
      evaluatePosition: async (value, exposure) => ({ ...(await adapter().evaluatePosition(value, exposure)), sellQuote: quote({ action: "sell", side: "yes", amount: "100", expectedShares: undefined, expectedNetProceeds: "90", expiresAt: new Date(Date.now() + 60_000).toISOString() }) }),
      executeSell: async () => { throw changed; },
    });
    await expect(runMarketTick({ tick: 1, config: live, adapter: sellRuntime })).resolves.toMatchObject({
      phase: "position", action: "hold", reason: "quote_changed_before_submission",
    });
  });

  it("locked_position_holds_then_settles_once_across_restart", async () => {
    let tick = 0;
    let terminalCalls = 0;
    let checkpoint: ActionCheckpoint | undefined;
    const locked = new StrykeSdkError("quote_blocked", "Trading is locked before settlement.", false, { phase: "locked" });
    const runtime = adapter({
      loadCheckpoint: async () => checkpoint,
      listPositions: async () => {
        tick += 1;
        return tick === 1
          ? [position()]
          : [position("claimable", { claimableAmount: "10", actionDeadline: new Date(Date.now() + 60_000).toISOString() })];
      },
      evaluatePosition: async () => { throw locked; },
      executeTerminal: async () => {
        terminalCalls += 1;
        checkpoint = { clientActionId: "claim-1", intentHash: "claim-intent", state: "submitted" };
        return { clientActionId: "claim-1" };
      },
      reconcilePending: async () => ({ state: "submitted", clientActionId: "claim-1" }),
    });

    const first = await runMarketTick({ tick: 1, config: live, adapter: runtime });
    const second = await runMarketTick({ tick: 2, config: live, adapter: runtime });
    const restarted = await runMarketTick({ tick: 3, config: live, adapter: runtime });
    expect([first.action, second.action, restarted.action]).toEqual(["hold", "claim", "blocked"]);
    expect(terminalCalls).toBe(1);
  });

  it("composed_loop_orders_buy_monitor_claim_and_next_market_over_multiple_iterations", async () => {
    let portfolioTick = 0;
    const actions: string[] = [];
    const runtime = adapter({
      listPositions: async () => {
        portfolioTick += 1;
        if (portfolioTick === 1) return [];
        if (portfolioTick === 2) return [position("sellable")];
        if (portfolioTick === 3) return [position("claimable", { claimableAmount: "10", actionDeadline: new Date(Date.now() + 60_000).toISOString() })];
        return [position("claimed")];
      },
      evaluatePosition: async (value, exposure) => ({ ...(await adapter().evaluatePosition(value, exposure)), sellQuote: quote({ action: "sell", side: "yes", amount: "100", expectedShares: undefined, expectedNetProceeds: "95", expiresAt: new Date(Date.now() + 60_000).toISOString() }) }),
      executeBuy: async () => { actions.push("buy"); return { clientActionId: "buy" }; },
      executeTerminal: async () => { actions.push("claim"); return { clientActionId: "claim" }; },
    });
    const events = await runReferenceBot({ config: live, adapter: runtime, maximumTicks: 4, wait: async () => {} });
    expect(events.map(({ action }) => action)).toEqual(["buy", "hold", "claim", "buy"]);
    expect(actions).toEqual(["buy", "claim", "buy"]);
  });

  it("entry_event_records_both_model_quote_fee_pool_and_size_inputs", async () => {
    const result = await runMarketTick({ tick: 1, config: live, adapter: adapter() });
    expect(result.details).toMatchObject({
      estimator: "distance_to_strike", yesModelProbability: expect.any(Number), noModelProbability: expect.any(Number),
      yesExecutableProbabilityBps: 4000, noExecutableProbabilityBps: 6000,
      yesEdgeBps: expect.any(Number), noEdgeBps: expect.any(Number), feeMode: "waived", closingPhase: "open",
      selectedSide: "yes", proposedSize: live.tradeSizeLamports.toString(),
    });
  });

  it("insufficient_volatility_history_blocks_then_recovers_on_a_later_tick", async () => {
    let enough = false;
    const runtime = adapter({
      evaluateEntry: async () => ({
        ...(await adapter().evaluateEntry()),
        estimatorInput: enough
          ? { currentPrice: 101, strikePrice: 100, secondsRemaining: 60, priceHistory: [{ price: 100, publishTime: 0 }, { price: 100.5, publishTime: 90 }, { price: 101, publishTime: 180 }] }
          : { currentPrice: 101, strikePrice: 100, secondsRemaining: 60, priceHistory: [{ price: 100, publishTime: 179 }, { price: 101, publishTime: 180 }] },
      }),
    });
    const config = parseReferenceBotConfig({ estimator: "volatility_adjusted_probability", killSwitchEnabled: false });
    await expect(runMarketTick({ tick: 1, config, adapter: runtime })).resolves.toMatchObject({ action: "decision_unavailable", reason: "model_inputs_unavailable" });
    enough = true;
    await expect(runMarketTick({ tick: 2, config, adapter: runtime })).resolves.toMatchObject({ phase: "entry" });
  });

  it("polymarket_relative_cli_loop_enters_holds_and_exits_on_convergence", async () => {
    const config = parseReferenceBotConfig({ estimator: "polymarket_relative_value", readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: false });
    const alignedMarket = { ...market, reference: { alignmentStatus: "aligned" } } as never;
    let tick = 0;
    const actions: string[] = [];
    const price = (bidBps: number, askBps: number) => ({ tokenId: "token", bidBps, askBps, spreadBps: askBps - bidBps, observedAtMs: Date.now() });
    const runtime = adapter({
      listPositions: async () => (++tick === 1 ? [] : [position()]),
      evaluateEntry: async () => ({
        ...(await adapter().evaluateEntry()), market: alignedMarket,
        polymarketPrices: { yes: price(5700, 6000), no: price(3500, 3800) },
      }),
      evaluatePosition: async (value, exposure) => ({
        ...(await adapter().evaluatePosition(value, exposure)), market: alignedMarket,
        sellQuote: quote({ action: "sell", side: "yes", amount: "100", expectedShares: undefined, expectedNetProceeds: "95", executableProbabilityBps: 4000, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
        polymarketPrices: tick === 2
          ? { yes: price(6000, 6200), no: price(3500, 3800) }
          : { yes: price(4200, 4400), no: price(3500, 3800) },
      }),
      executeBuy: async () => { actions.push("buy"); return { clientActionId: "buy" }; },
      executeSell: async () => { actions.push("sell"); return { clientActionId: "sell" }; },
    });
    const events = await runReferenceBot({ config, adapter: runtime, maximumTicks: 3, wait: async () => {} });
    expect(events.map(({ action, reason }) => [action, reason])).toEqual([
      ["buy", "polymarket_relative_edge"],
      ["hold", "position_not_economically_complete"],
      ["sell", "polymarket_convergence"],
    ]);
    expect(actions).toEqual(["buy", "sell"]);
  });

  it("polymarket_relative_strategy_skips_degraded_reference_without_external_prices", async () => {
    const config = parseReferenceBotConfig({ estimator: "polymarket_relative_value", killSwitchEnabled: false });
    const runtime = adapter({ evaluateEntry: async () => ({
      ...(await adapter().evaluateEntry()),
      market: { ...market, reference: { alignmentStatus: "degraded" } } as never,
      polymarketPrices: undefined,
    }) });
    await expect(runMarketTick({ tick: 1, config, adapter: runtime }))
      .resolves.toMatchObject({ action: "skip", reason: "reference_not_aligned" });
    expect(runtime.executeBuy).not.toHaveBeenCalled();
  });

  it("polymarket_relative_strategy_blocks_same_round_after_restart_but_allows_next_round", async () => {
    const config = parseReferenceBotConfig({ estimator: "polymarket_relative_value", readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: false });
    let exitedMarketId = "market-1";
    let currentMarketId = "market-1";
    const price = (bidBps: number, askBps: number) => ({ tokenId: "token", bidBps, askBps, spreadBps: askBps - bidBps, observedAtMs: Date.now() });
    const runtime = adapter({
      evaluateEntry: async () => ({
        ...(await adapter().evaluateEntry()),
        market: { ...market, marketId: currentMarketId, reference: { alignmentStatus: "aligned" } } as never,
        polymarketPrices: { yes: price(5700, 6000), no: price(3500, 3800) },
      }),
      hasConvergenceExitedRound: async (candidate) => candidate.marketId === exitedMarketId,
    });
    await expect(runMarketTick({ tick: 1, config, adapter: runtime }))
      .resolves.toMatchObject({ action: "skip", reason: "same_round_reentry_blocked" });
    currentMarketId = "market-2";
    await expect(runMarketTick({ tick: 2, config, adapter: runtime }))
      .resolves.toMatchObject({ action: "buy", reason: "polymarket_relative_edge", marketId: "market-2" });
    exitedMarketId = "none";
  });

  it("unavailable_polymarket_exit_keeps_native_stop_loss_and_safe_hold_active", async () => {
    const config = parseReferenceBotConfig({ estimator: "polymarket_relative_value", readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: false });
    for (const [proceeds, action, reason] of [["90", "sell", "stop_loss"], ["95", "hold", "position_not_economically_complete"]] as const) {
      const runtime = adapter({
        listPositions: async () => [position()],
        evaluatePosition: async () => ({
          ...(await adapter().evaluatePosition(position(), { side: "yes", shares: "100", costBasisCollateralUnits: "100" })),
          sellQuote: quote({ action: "sell", side: "yes", amount: "100", expectedShares: undefined, expectedNetProceeds: proceeds, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
          polymarketPrices: undefined,
          polymarketUnavailable: true,
        }),
      });
      await expect(runMarketTick({ tick: 1, config, adapter: runtime })).resolves.toMatchObject({ action, reason });
    }
  });
});
