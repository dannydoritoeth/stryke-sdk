import { StrykeSdkError } from "@stryketrade/sdk";
import { describe, expect, it, vi } from "vitest";

import { runReferenceBot, type ReferenceBotRuntimeAdapter } from "../src/bot.js";
import { parseReferenceBotConfig } from "../src/config.js";
import {
  requireRuntimeLease,
  type RuntimeLease,
  type RuntimeLeaseIdentity,
  type RuntimeLeaseStore,
} from "../src/runtime-lease.js";

const config = parseReferenceBotConfig({ tickIntervalMs: 1_000 });
const identity: RuntimeLeaseIdentity = {
  cluster: "mainnet-beta",
  wallet: "wallet-1",
  asset: "BTC",
  expiryFamily: "five_minute",
};

const adapter = (calls: string[]): ReferenceBotRuntimeAdapter => ({
  loadCheckpoint: async () => { calls.push("market"); return undefined; },
  reconcilePending: async () => { throw new Error("not reached"); },
  listPositions: async () => [],
  evaluatePosition: async () => { throw new Error("not reached"); },
  evaluateEntry: async () => { throw new StrykeSdkError("source_unavailable", "wait", true); },
  executeBuy: async () => { throw new Error("not reached"); },
  executeSell: async () => { throw new Error("not reached"); },
  executeTerminal: async () => { throw new Error("not reached"); },
});

describe("reference bot runtime lease", () => {
  it("fails_closed_when_another_process_holds_the_identity", async () => {
    const store: RuntimeLeaseStore = { acquire: async () => undefined };
    await expect(requireRuntimeLease(store, identity, "candidate-2")).rejects.toMatchObject({
      code: "configuration",
    });
  });

  it("checks_the_lease_before_each_tick_and_releases_on_completion", async () => {
    const calls: string[] = [];
    const lease: RuntimeLease = {
      identity,
      holderId: "candidate-1",
      assertHeld: async () => { calls.push("lease"); },
      release: vi.fn(async () => {}),
    };

    await runReferenceBot({
      config,
      adapter: adapter(calls),
      runtimeLease: lease,
      maximumTicks: 2,
      wait: async () => {},
      onEvent: () => {},
    });

    expect(calls).toEqual(["lease", "market", "lease", "market"]);
    expect(lease.release).toHaveBeenCalledOnce();
  });

  it("stops_before_market_work_when_the_lease_is_lost", async () => {
    const calls: string[] = [];
    let checks = 0;
    const lease: RuntimeLease = {
      identity,
      holderId: "candidate-1",
      assertHeld: async () => {
        calls.push("lease");
        checks += 1;
        if (checks === 2) throw new Error("expired");
      },
      release: vi.fn(async () => {}),
    };

    await expect(runReferenceBot({
      config,
      adapter: adapter(calls),
      runtimeLease: lease,
      maximumTicks: 3,
      wait: async () => {},
      onEvent: () => {},
    })).rejects.toMatchObject({ code: "configuration" });

    expect(calls).toEqual(["lease", "market", "lease"]);
    expect(lease.release).toHaveBeenCalledOnce();
  });
});
