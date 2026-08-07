import { describe, expect, it } from "vitest";

import { decidePolymarketEarlyExit } from "../src/strategy/polymarket-exit.js";
import { quote } from "./fixtures.js";

const prices = {
  yes: { tokenId: "yes", bidBps: 5_200, askBps: 5_300, spreadBps: 100, observedAtMs: 1 },
  no: { tokenId: "no", bidBps: 4_700, askBps: 4_800, spreadBps: 100, observedAtMs: 1 },
} as const;

const decide = (overrides: Partial<Parameters<typeof decidePolymarketEarlyExit>[0]> = {}) =>
  decidePolymarketEarlyExit({
    policy: "exit_on_convergence",
    side: "yes",
    sellQuote: quote({ action: "sell", side: "yes", amount: "100", expectedShares: undefined, expectedNetProceeds: "95", normalizedSideProbabilityBps: 5_000, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    shares: "100",
    costBasisCollateralUnits: "100",
    ifWinPayout: "100",
    stopLossBps: 1_000,
    takeProfitBps: 2_000,
    prices,
    exitEdgeBps: 200,
    ...overrides,
  });

describe("Polymarket early exit policy", () => {
  it("early_hold_policy_ignores_convergence", () => {
    expect(decide({ policy: "hold_to_expiry" }).decision).toMatchObject({ action: "hold", reason: "strategy_holds_to_expiry" });
  });

  it("early_convergence_policy_uses_polymarket_bid_not_fifty_percent", () => {
    expect(decide().decision).toMatchObject({ action: "sell", reason: "polymarket_convergence" });
    expect(decide({ prices: undefined }).decision).toMatchObject({ action: "hold" });
  });

  it("early_risk_managed_policy_applies_stop_loss_and_take_profit", () => {
    expect(decide({ policy: "risk_managed", prices: undefined, sellQuote: quote({ action: "sell", side: "yes", amount: "100", expectedShares: undefined, expectedNetProceeds: "90", normalizedSideProbabilityBps: 5_000, expiresAt: new Date(Date.now() + 60_000).toISOString() }) }).decision)
      .toMatchObject({ action: "sell", reason: "stop_loss" });
    expect(decide({ policy: "risk_managed", prices: undefined, sellQuote: quote({ action: "sell", side: "yes", amount: "100", expectedShares: undefined, expectedNetProceeds: "120", normalizedSideProbabilityBps: 5_000, expiresAt: new Date(Date.now() + 60_000).toISOString() }) }).decision)
      .toMatchObject({ action: "sell", reason: "take_profit" });
  });
});
