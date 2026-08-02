import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../scripts/devnet-bot-matrix.mjs", import.meta.url), "utf8");

describe("reference-bot devnet matrix runner", () => {
  it("invokes_the_real_reference_bot_cli_for_the_aligned_strategy_matrix", () => {
    expect(source).toContain('examples/reference-bot/dist/cli.js');
    expect(source).toContain('"--profile=devnet"');
    expect(source).toContain('["BTC", "SOL"]');
    for (const expiry of ["five_minute", "fifteen_minute", "hourly"]) expect(source).toContain(`"${expiry}"`);
    expect(source).not.toContain('"one_minute"');
    expect(source).toContain('["polymarket_early", "polymarket_late"]');
    expect(source).toContain("STRYKE_STRATEGY: strategy");
    expect(source).not.toMatch(/packages\/sdk|test\/devnet|devnet-lifecycle-matrix/);
  });

  it("requires_multi_tick_action_and_next_market_evidence", () => {
    expect(source).toContain("result.tickCount >= 2");
    expect(source).toContain('event.action === "buy" && event.signature');
    expect(source).toContain("result.lifecycleCompleted");
    expect(source).toContain("result.nextMarketEvaluated");
    expect(source).toContain("completedByStrategy[strategy] >= 2");
    expect(source).toContain('selectedSides.includes("yes") && selectedSides.includes("no")');
    expect(source).toContain("STRYKE_ROUND_STATE_PATH: roundState");
  });

  it("matrix_paper_follow_up_retries_rollover_until_entry_evaluation", () => {
    expect(source).toContain('"--profile=paper"');
    expect(source).not.toContain('"--profile=paper", "--once"');
    expect(source).toContain('event.phase === "entry"');
    expect(source).toContain("paperTimeoutSeconds * 1_000");
  });

  it("retries_only_a_zero-transaction_transient_infrastructure_failure_once", () => {
    expect(source).toContain("!result.timedOut");
    expect(source).toContain("!result.actions.some((event) => event.signature)");
    expect(source).toContain('event.event === "reference_bot_preflight" && event.status === "failed"');
    expect(source).toContain('event.event === "reference_bot_error" && event.message === "fetch failed"');
    expect(source).toContain("result = await runCell(cell, 2)");
    expect(source).not.toContain("runCell(cell, 3)");
  });

  it("lets_early_strategy_trade_first_then_seeds_the_exact_signed_market", () => {
    expect(source).toContain('strategy === "polymarket_early"');
    expect(source).toContain('marketId: event.marketId');
    expect(source).toContain('strategy === "polymarket_late"');
    expect(source).toContain('result.liquiditySeed');
    expect(source).toContain('{ liquidityFailure }');
    expect(source).toContain('devnet_bot_matrix_stopped_after_incomplete_cell');
  });
});
