import { describe, expect, it } from "vitest";
import sellEvidence from "../fixtures/devnet-sell-matrix.json" with { type: "json" };
import canonicalBtc5 from "../fixtures/devnet-canonical-btc5.json" with { type: "json" };
import {
  MemoryActionCheckpointStore,
  ReviewedTransactionExecutor,
} from "../../packages/sdk/src/index.js";

import { matrixEvidence, verifyCell, verifyFinalized } from "./helpers.js";

describe("authoritative devnet pilot lifecycle evidence", () => {
  it("devnet_btc_1m_complete_lifecycle_with_latency_evidence", async () => {
    await verifyCell("BTC", "1m");
    expect(matrixEvidence.oneMinuteTimingEvidence).toMatchObject({ liveStrategyPerformance: "experimental" });
    expect(matrixEvidence.oneMinuteTimingEvidence.completionSecondsAfterExpiry).toBeGreaterThan(0);
  }, 30_000);
  it("devnet_btc_5m_complete_lifecycle_and_claim_or_refund", async () => {
    await verifyCell("BTC", "5m");
    expect(canonicalBtc5.durationSeconds).toBeLessThan(3_600);
    expect(canonicalBtc5.undocumentedInterventions).toBe(0);
    await verifyFinalized(Object.values(canonicalBtc5.signatures));
  }, 30_000);
  it("devnet_btc_15m_complete_lifecycle", () => verifyCell("BTC", "15m"), 30_000);
  it("devnet_btc_1h_complete_lifecycle", () => verifyCell("BTC", "1h"), 30_000);
  it("devnet_sol_1m_complete_lifecycle_with_latency_evidence", async () => {
    await verifyCell("SOL", "1m");
    expect(matrixEvidence.oneMinuteTimingEvidence.liveStrategyPerformance).toBe("experimental");
  }, 30_000);
  it("devnet_sol_5m_complete_lifecycle", () => verifyCell("SOL", "5m"), 30_000);
  it("devnet_sol_15m_complete_lifecycle", () => verifyCell("SOL", "15m"), 30_000);
  it("devnet_sol_1h_complete_lifecycle", () => verifyCell("SOL", "1h"), 30_000);

  it("devnet_sell_coverage_btc_and_sol_short_and_long_expiry", async () => {
    expect(sellEvidence.cells.map(({ asset, expiry }) => `${asset}:${expiry}`).sort()).toEqual([
      "BTC:1h", "BTC:1m", "SOL:1h", "SOL:1m",
    ]);
    await verifyFinalized(
      sellEvidence.cells.flatMap((row) => [row.buyYes, row.sellYes, row.buyNo, row.sellNo])
    );
  }, 30_000);

  it("devnet_restart_unknown_action_does_not_duplicate", async () => {
    const store = new MemoryActionCheckpointStore();
    const clientActionId = "pilot_5SJTm7_restart_unknown";
    const intentHash = `intent_v1_${"5".repeat(64)}`;
    await store.save({ clientActionId, intentHash, state: "unknown" });
    let submissions = 0;
    const executor = new ReviewedTransactionExecutor(
      { reconcile: async () => ({ apiVersion: "v1", schemaVersion: "stryke.pilotAction.v1", clientActionId, intentHash, state: "unknown", rawReason: "devnet_status_unknown", observedAt: new Date().toISOString(), raw: {} }) } as never,
      store,
      { submit: async () => { submissions += 1; return "unexpected"; } } as never
    );
    await expect(executor.resume()).rejects.toMatchObject({ code: "duplicate_action" });
    expect(submissions).toBe(0);
    await expect(store.load()).resolves.toMatchObject({ state: "unknown" });
  });
});
