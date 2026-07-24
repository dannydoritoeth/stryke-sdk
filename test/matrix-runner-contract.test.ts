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
    expect(source).toContain("result.actions.length > 0");
    expect(source).toContain("result.nextMarketEvaluated");
  });
});
