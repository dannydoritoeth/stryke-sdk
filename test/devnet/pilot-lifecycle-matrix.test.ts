import { describe, expect, it } from "vitest";

import { matrixEvidence, verifyCell } from "./helpers.js";

describe("authoritative devnet pilot lifecycle evidence", () => {
  it("devnet_btc_1m_complete_lifecycle_with_latency_evidence", async () => {
    await verifyCell("BTC", "1m");
    expect(matrixEvidence.oneMinuteTimingEvidence).toMatchObject({ liveStrategyPerformance: "experimental" });
    expect(matrixEvidence.oneMinuteTimingEvidence.completionSecondsAfterExpiry).toBeGreaterThan(0);
  }, 30_000);
  it("devnet_btc_5m_complete_lifecycle_and_claim_or_refund", () => verifyCell("BTC", "5m"), 30_000);
  it("devnet_btc_15m_complete_lifecycle", () => verifyCell("BTC", "15m"), 30_000);
  it("devnet_btc_1h_complete_lifecycle", () => verifyCell("BTC", "1h"), 30_000);
  it("devnet_sol_1m_complete_lifecycle_with_latency_evidence", async () => {
    await verifyCell("SOL", "1m");
    expect(matrixEvidence.oneMinuteTimingEvidence.liveStrategyPerformance).toBe("experimental");
  }, 30_000);
  it("devnet_sol_5m_complete_lifecycle", () => verifyCell("SOL", "5m"), 30_000);
  it("devnet_sol_15m_complete_lifecycle", () => verifyCell("SOL", "15m"), 30_000);
  it("devnet_sol_1h_complete_lifecycle", () => verifyCell("SOL", "1h"), 30_000);

  it.skip("devnet_sell_coverage_btc_and_sol_short_and_long_expiry", () => {
    // Open: retained evidence has SOL sell coverage only; a fresh four-cell run is required.
  });

  it.skip("devnet_restart_unknown_action_does_not_duplicate", () => {
    // Open: requires a fresh submitted/unknown action under the invited pilot wallet.
  });
});
