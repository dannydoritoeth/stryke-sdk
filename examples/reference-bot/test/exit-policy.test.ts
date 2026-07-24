import { describe, expect, it } from "vitest";

import { decidePositionExit } from "../src/manage-position.js";
import { quote } from "./fixtures.js";

const sell = (side: "yes" | "no", proceeds: string, amount = "100") => quote({
  action: "sell", side, amount, expectedShares: undefined, expectedNetProceeds: proceeds,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
const decide = (overrides: Record<string, unknown> = {}) => decidePositionExit({
  side: "yes", fairProbability: 0.5, sellQuote: sell("yes", "90"), shares: "100",
  costBasisCollateralUnits: "100", ifWinPayout: "200", stopLossBps: 1_000,
  takeProfitBps: 2_000, ...overrides,
} as never);

describe("position exit policy", () => {
  it("stop_loss_below_and_at_boundary_sells", () => {
    expect(decide({ sellQuote: sell("yes", "89") })).toMatchObject({ action: "sell", reason: "stop_loss" });
    expect(decide()).toMatchObject({ action: "sell", reason: "stop_loss", pnlBps: -1000n });
  });

  it("take_profit_above_and_at_boundary_sells", () => {
    expect(decide({ sellQuote: sell("yes", "120") })).toMatchObject({ action: "sell", reason: "take_profit", pnlBps: 2000n });
    expect(decide({ sellQuote: sell("yes", "121") })).toMatchObject({ action: "sell", reason: "take_profit" });
  });

  it("neither_threshold_falls_through_to_ev", () => {
    expect(decide({ sellQuote: sell("yes", "100"), ifWinPayout: "100" })).toMatchObject({ action: "sell", reason: "sell_now_exceeds_probability_weighted_hold" });
  });

  it("yes_and_no_require_their_matching_full_side_exposure", () => {
    expect(decide({ side: "no", sellQuote: sell("no", "90") })).toMatchObject({ action: "sell", reason: "stop_loss" });
    expect(decide({ side: "no", sellQuote: sell("yes", "90") })).toMatchObject({ action: "decision_unavailable" });
  });

  it("missing_stale_zero_pending_or_invalid_inputs_block", () => {
    for (const overrides of [
      { costBasisCollateralUnits: "0" }, { costBasisCollateralUnits: undefined },
      { sellQuote: undefined }, { sellQuote: sell("yes", "90", "99") },
      { sellQuote: { ...sell("yes", "90"), expiresAt: new Date(0).toISOString() } },
      { pendingAction: true }, { stopLossBps: 0 }, { takeProfitBps: 0 },
    ]) expect(decide(overrides)).toMatchObject({ action: "decision_unavailable" });
  });
});
