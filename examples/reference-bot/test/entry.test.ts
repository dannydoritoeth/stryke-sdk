import { describe, expect, it } from "vitest";

import { parseReferenceBotConfig } from "../src/config.js";
import { decideEntry } from "../src/entry.js";
import { quote } from "./fixtures.js";

const live = parseReferenceBotConfig({ readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: false, walletAdapterPath: "./wallet.js" });
const input = () => ({ fairProbability: 0.7, quote: quote(), config: live, secondsRemaining: 120, tradeSizeLamports: 10_000_000n, aggregateExposureLamports: 0n, openPositions: 0, dataFresh: true });

describe("entry decisions", () => {
  it("buys_only_when_edge_and_all_safety_controls_pass", () => expect(decideEntry(input())).toMatchObject({ action: "buy", reason: "entry_edge_and_safety_passed" }));

  it("yes_and_no_use_correct_side_probability", () => {
    expect(decideEntry(input()).sideFairProbability).toBe(0.7);
    expect(decideEntry({ ...input(), fairProbability: 0.3, quote: quote({ side: "no" }) }).sideFairProbability).toBe(0.7);
  });

  it("edge_impact_time_size_position_and_aggregate_caps_each_block_entry", () => {
    const cases = [
      { expected: "edge", change: { fairProbability: 0.5 } },
      { expected: "priceImpact", change: { quote: quote({ priceImpactBps: 101 }) } },
      { expected: "time", change: { secondsRemaining: 59 } },
      { expected: "size", change: { tradeSizeLamports: 11_000_000n } },
      { expected: "positions", change: { openPositions: 3 } },
      { expected: "aggregateExposure", change: { aggregateExposureLamports: 50_000_000n } },
      { expected: "fresh", change: { dataFresh: false } },
    ];
    for (const testCase of cases) expect(decideEntry({ ...input(), ...testCase.change }).reason).toBe(testCase.expected);
  });

  it("submitted_or_unknown_checkpoint_blocks_entry", () => {
    for (const state of ["submitted", "unknown"] as const) {
      expect(decideEntry({ ...input(), checkpoint: { clientActionId: "a", intentHash: "h", state } }).reason).toBe("checkpoint");
    }
  });

  it("dry_run_records_decision_without_wallet_or_submission", () => {
    const decision = decideEntry({ ...input(), config: parseReferenceBotConfig({ killSwitchEnabled: false }) });
    expect(decision).toMatchObject({ action: "dry_run", reason: "read_only", quoteId: "quote-1" });
  });
});
