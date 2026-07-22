import { describe, expect, it, vi } from "vitest";

import { decideOpenPosition, manageTerminalPosition } from "../src/manage-position.js";
import { position, quote } from "./fixtures.js";

describe("position management", () => {
  it("sell_when_executable_net_proceeds_exceed_probability_weighted_hold_value", () => {
    expect(decideOpenPosition({ side: "yes", fairProbability: 0.5, sellQuote: quote({ action: "sell", expectedShares: undefined, expectedNetProceeds: "60" }), ifWinPayout: "100" })).toMatchObject({ action: "sell", sellNowValue: 60n, holdValue: 50n });
  });

  it("hold_when_hold_value_is_greater_or_equal", () => {
    expect(decideOpenPosition({ side: "no", fairProbability: 0.4, sellQuote: quote({ action: "sell", expectedShares: undefined, expectedNetProceeds: "60" }), ifWinPayout: "100" }).action).toBe("hold");
  });

  it("missing_sell_quote_or_if_win_payout_returns_decision_unavailable", () => {
    expect(decideOpenPosition({ side: "yes", fairProbability: 0.5, ifWinPayout: "100" }).action).toBe("decision_unavailable");
    expect(decideOpenPosition({ side: "yes", fairProbability: 0.5, sellQuote: quote() }).action).toBe("decision_unavailable");
  });

  it("claimable_position_uses_claim_flow", async () => {
    const prepare = vi.fn().mockResolvedValue({});
    await expect(manageTerminalPosition(position(), prepare, Date.parse("2026-07-22T12:00:00Z"))).resolves.toMatchObject({ action: "claim" });
    expect(prepare).toHaveBeenCalledWith("claim", expect.anything());
  });

  it("refundable_position_uses_refund_flow", async () => {
    const prepare = vi.fn().mockResolvedValue({});
    const refundable = position({ claimableAmount: undefined, refundableAmount: "10", lifecycle: { state: "refundable", rawState: "refundable", rawReason: "underfunded", observedAt: "2026-07-22T00:00:00Z", source: "api_v1" } });
    await expect(manageTerminalPosition(refundable, prepare, Date.parse("2026-07-22T12:00:00Z"))).resolves.toMatchObject({ action: "refund" });
  });

  it("pyth_price_alone_never_marks_position_resolved", async () => {
    const prepare = vi.fn();
    const unresolved = position({ lifecycle: { state: "awaiting_resolution", rawState: "trading_closed", rawReason: "awaiting_resolution", observedAt: "2026-07-22T00:00:00Z", source: "api_v1" } });
    await expect(manageTerminalPosition(unresolved, prepare, Date.parse("2026-07-22T12:00:00Z"))).resolves.toMatchObject({ action: "decision_unavailable" });
    expect(prepare).not.toHaveBeenCalled();
  });
});
