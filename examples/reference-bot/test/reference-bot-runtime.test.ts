import { describe, expect, it, vi } from "vitest";
import type { ActionCheckpoint, PilotPosition } from "@stryke/sdk";
import { StrykeSdkError } from "@stryke/sdk";

import { runMarketTick, runReferenceBot, type ReferenceBotRuntimeAdapter } from "../src/bot.js";
import { parseReferenceBotConfig } from "../src/config.js";
import { quote } from "./fixtures.js";

const history = [{ price: 99, publishTime: 1 }, { price: 100, publishTime: 2 }];
const market = { marketId: "market-1" } as never;
const position = (state: PilotPosition["lifecycle"]["state"] = "sellable", overrides: Partial<PilotPosition> = {}): PilotPosition => ({
  positionId: "position-1", owner: "owner", market: {}, yesShares: "100", noShares: "0",
  yesCostBasisCollateralUnits: "100", lifecycle: { schemaVersion: "stryke.pilotLifecycle.v1", state, rawStatus: state, rawReason: state, observedAt: new Date().toISOString() }, raw: {}, ...overrides,
});
const live = parseReferenceBotConfig({ readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: false });

const adapter = (overrides: Partial<ReferenceBotRuntimeAdapter> = {}): ReferenceBotRuntimeAdapter => ({
  loadCheckpoint: vi.fn(async () => undefined),
  reconcilePending: vi.fn(async (checkpoint: ActionCheckpoint) => ({ state: "confirmed", clientActionId: checkpoint.clientActionId })),
  listPositions: vi.fn(async () => []),
  evaluatePosition: vi.fn(async () => ({ market, estimatorInput: { currentPrice: 100, strikePrice: 100, secondsRemaining: 120, priceHistory: history }, sellQuote: quote({ action: "sell", side: "yes", amount: "100", expectedShares: undefined, expectedNetProceeds: "90", expiresAt: new Date(Date.now() + 60_000).toISOString() }), ifWinPayout: "200", dataFresh: true })),
  evaluateEntry: vi.fn(async () => ({ market, estimatorInput: { currentPrice: 101, strikePrice: 100, secondsRemaining: 120, priceHistory: history }, buyQuote: quote({ side: "yes", amount: live.tradeSizeLamports.toString(), executableProbabilityBps: 4000 }), aggregateExposureLamports: 0n, openPositions: 0, dataFresh: true })),
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

  it("runtime_stop_loss_and_take_profit_execute_full_position_sell", async () => {
    for (const [proceeds, reason] of [["90", "stop_loss"], ["120", "take_profit"]] as const) {
      const runtime = adapter({ listPositions: async () => [position()], evaluatePosition: async (value, exposure) => ({ ...(await adapter().evaluatePosition(value, exposure)), sellQuote: quote({ action: "sell", side: "yes", amount: "100", expectedShares: undefined, expectedNetProceeds: proceeds, expiresAt: new Date(Date.now() + 60_000).toISOString() }) }) });
      await expect(runMarketTick({ tick: 1, config: live, adapter: runtime })).resolves.toMatchObject({ action: "sell", reason });
      expect(runtime.executeSell).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ shares: "100" }), expect.objectContaining({ sellQuote: expect.objectContaining({ amount: "100" }) }));
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

  it("runtime_read_only_uses_real_sdk_tick_without_wallet_or_submission", async () => {
    const runtime = adapter();
    await expect(runMarketTick({ tick: 1, config: parseReferenceBotConfig({ killSwitchEnabled: false }), adapter: runtime })).resolves.toMatchObject({ action: "dry_run", reason: "read_only" });
    expect(runtime.executeBuy).not.toHaveBeenCalled();
  });

  it("runtime_reports_retryable_unavailability_and_continues_next_tick", async () => {
    const controller = new AbortController();
    let calls = 0;
    const runtime = adapter({ evaluateEntry: async () => { calls += 1; if (calls === 1) throw new StrykeSdkError("source_unavailable", "rolling market unavailable", true); return adapter().evaluateEntry(); } });
    const events = await runReferenceBot({ config: parseReferenceBotConfig({ killSwitchEnabled: false }), adapter: runtime, wait: async () => {}, onEvent: () => { if (calls === 2) controller.abort(); }, signal: controller.signal });
    expect(events.map(({ reason }) => reason)).toEqual(["retryable_source_unavailable", "read_only"]);
  });
});
