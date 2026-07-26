import { describe, expect, it } from "vitest";
import { activationEntryDecision } from "../src/activation-policy.js";
import { calculateBufferedEntrySize } from "../src/sizing.js";
import { quote } from "./fixtures.js";

describe("activation-aware entry sizing", () => {
  it("activation_capacity_excludes_virtual_liquidity", () => {
    expect(calculateBufferedEntrySize({ configuredTradeSize: 1_000n, maximumTradeSize: 2_000n, aggregateExposure: 0n, maximumAggregateExposure: 5_000n, yesRealPool: 8_000n, noRealPool: 8_500n, yesActivated: false, noActivated: false, activationLimit: 10_000n, activationBuffer: 500n })).toBe(1_000n);
  });
  it("threshold_crossing_and_buffer_cannot_be_exceeded", () => {
    expect(calculateBufferedEntrySize({ configuredTradeSize: 1_000n, maximumTradeSize: 2_000n, aggregateExposure: 0n, maximumAggregateExposure: 5_000n, yesRealPool: 9_250n, noRealPool: 9_000n, yesActivated: false, noActivated: false, activationLimit: 10_000n, activationBuffer: 500n })).toBe(250n);
  });
  it("all_size_caps_reach_the_final_minimum", () => {
    const base = { configuredTradeSize: 1_000n, maximumTradeSize: 2_000n, aggregateExposure: 0n, maximumAggregateExposure: 5_000n, yesRealPool: 0n, noRealPool: 0n, yesActivated: false, noActivated: false, activationLimit: 10_000n, activationBuffer: 500n };
    expect(calculateBufferedEntrySize({ ...base, maximumTradeSize: 700n })).toBe(700n);
    expect(calculateBufferedEntrySize({ ...base, aggregateExposure: 4_400n })).toBe(600n);
    expect(calculateBufferedEntrySize({ ...base, yesRealPool: 20_000n, yesActivated: true })).toBe(1_000n);
    expect(calculateBufferedEntrySize({ ...base, yesActivated: true, noActivated: true })).toBe(0n);
  });
  it("closing_and_locked_phases_never_open_positions", () => {
    expect(activationEntryDecision(quote()).allowed).toBe(true);
    for (const phase of ["closing", "locked", "expired"] as const) {
      expect(activationEntryDecision(quote({ closingProtection: { ...quote().closingProtection, phase, closingFeeBps: phase === "closing" ? 300 : 0, effectiveFeeBps: phase === "closing" ? 300 : 0 } })).allowed).toBe(false);
    }
  });
  it("activated_or_incoherent_fee_modes_fail_closed", () => {
    expect(activationEntryDecision(quote({ feeBreakdown: { ...quote().feeBreakdown, feeMode: "standard", normalTradingFeeBps: 100, feeBpsApplied: 100 }, closingProtection: { ...quote().closingProtection, baseFeeBps: 100, effectiveFeeBps: 100 } })).reason).toBe("side_already_activated");
    expect(activationEntryDecision(quote({ feeBreakdown: { ...quote().feeBreakdown, feeBpsApplied: 1 } })).reason).toBe("fee_free_policy_incoherent");
  });
});
