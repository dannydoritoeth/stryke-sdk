import { describe, expect, it } from "vitest";
import type { ActionCheckpoint } from "@stryke/sdk";

import { runMarketTick, type ReferenceBotRuntimeAdapter } from "../src/bot.js";
import { parseReferenceBotConfig } from "../src/config.js";

const config = parseReferenceBotConfig({ readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: false });

describe("reference bot restart behavior", () => {
  it.each(["not_submitted", "submitted", "unknown"] as const)("%s checkpoint reconciles before any new work", async (state) => {
    const calls: string[] = [];
    const checkpoint: ActionCheckpoint = { clientActionId: "action-1", intentHash: "intent-1", state };
    const adapter = {
      loadCheckpoint: async () => checkpoint,
      reconcilePending: async () => { calls.push("reconcile"); return { state, clientActionId: checkpoint.clientActionId }; },
      listPositions: async () => { calls.push("positions"); return []; },
    } as unknown as ReferenceBotRuntimeAdapter;
    await expect(runMarketTick({ tick: 1, config, adapter })).resolves.toMatchObject({ phase: "reconcile", action: "blocked" });
    expect(calls).toEqual(["reconcile"]);
  });

  it.each(["confirmed", "failed", "expired"] as const)("%s reconciliation completes exactly one tick before new work", async (state) => {
    let checkpoint: ActionCheckpoint | undefined = { clientActionId: "action-1", intentHash: "intent-1", state: "submitted" };
    let reconciliations = 0;
    const adapter = {
      loadCheckpoint: async () => checkpoint,
      reconcilePending: async () => { reconciliations += 1; checkpoint = undefined; return { state, clientActionId: "action-1" }; },
      listPositions: async () => [],
      evaluateEntry: async () => { throw new Error("next tick reached entry"); },
    } as unknown as ReferenceBotRuntimeAdapter;
    await expect(runMarketTick({ tick: 1, config, adapter })).resolves.toMatchObject({ action: "complete", reason: `reconciled_${state}` });
    await expect(runMarketTick({ tick: 2, config, adapter })).rejects.toThrow("next tick reached entry");
    expect(reconciliations).toBe(1);
  });
});
