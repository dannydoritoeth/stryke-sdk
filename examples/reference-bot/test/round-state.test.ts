import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileRoundDecisionStore } from "../src/round-state.js";

describe("restart-safe convergence round state", () => {
  it("persists_same_round_exit_and_allows_the_next_round_after_restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stryke-round-state-"));
    try {
      const path = join(directory, "rounds.json");
      const current = { marketId: "market-1", expiryTs: 100, strikePrice: "50" };
      const next = { marketId: "market-2", expiryTs: 200, strikePrice: "51" };
      await new FileRoundDecisionStore(path).recordConvergenceExit(current);
      const restarted = new FileRoundDecisionStore(path);
      await expect(restarted.hasConvergenceExit(current)).resolves.toBe(true);
      await expect(restarted.hasConvergenceExit(next)).resolves.toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("persists_entry_and_blocks_only_the_same_round_after_restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stryke-round-entry-"));
    try {
      const path = join(directory, "rounds.json");
      const current = { marketId: "market-1", expiryTs: 100, strikePrice: "50" };
      const next = { marketId: "market-2", expiryTs: 200, strikePrice: "51" };
      await new FileRoundDecisionStore(path).recordEntry(current);
      const restarted = new FileRoundDecisionStore(path);
      await expect(restarted.hasEntry(current)).resolves.toBe(true);
      await expect(restarted.hasEntry(next)).resolves.toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
