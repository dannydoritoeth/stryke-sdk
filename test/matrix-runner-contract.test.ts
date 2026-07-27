import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../scripts/devnet-bot-matrix.mjs", import.meta.url), "utf8");

describe("reference-bot devnet matrix runner", () => {
  it("invokes_the_real_reference_bot_cli_for_all_eight_cells", () => {
    expect(source).toContain('examples/reference-bot/dist/cli.js');
    expect(source).toContain('"--profile=devnet"');
    expect(source).toContain('["BTC", "SOL"]');
    for (const expiry of ["one_minute", "five_minute", "fifteen_minute", "hourly"]) expect(source).toContain(`"${expiry}"`);
    expect(source).not.toMatch(/packages\/sdk|test\/devnet|devnet-lifecycle-matrix/);
  });

  it("requires_multi_tick_action_and_next_market_evidence", () => {
    expect(source).toContain("result.tickCount >= 2");
    expect(source).toContain('event.action === "buy" && event.signature');
    expect(source).toContain("result.lifecycleCompleted");
    expect(source).toContain("result.nextMarketEvaluated");
    expect(source).toContain('STRYKE_MATRIX_ONE_MINUTE_MINIMUM_SECONDS ?? "5"');
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
});
