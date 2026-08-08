import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresReferenceBotState } from "../src/postgres-state.js";
import { runReferenceBot } from "../src/bot.js";
import { parseReferenceBotConfig } from "../src/config.js";

const databaseUrl = process.env.TEST_POSTGRES_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("optional Postgres reference-bot state", () => {
  const pools: Pool[] = [];
  const state = (namespace: string, ttl = 30_000) => {
    const pool = new Pool({ connectionString: databaseUrl });
    pools.push(pool);
    return new PostgresReferenceBotState(pool, namespace, ttl);
  };

  beforeAll(async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    await pool.query("drop table if exists stryke_reference_bot_leases, stryke_reference_bot_state");
    await pool.end();
  });

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()));
  });

  it("initializes the schema idempotently from concurrent clients", async () => {
    const first = state("schema");
    const second = state("schema");
    await expect(Promise.all([first.initialize(), second.initialize()])).resolves.toEqual([undefined, undefined]);
  });

  it("persists checkpoints and round decisions across store instances", async () => {
    const first = state("restart");
    await first.initialize();
    await first.save({ clientActionId: "buy-1", intentHash: "intent-1", state: "submitted" });
    const round = { marketId: "btc-5m", expiryTs: 1_800_000_000, strikePrice: "70000" };
    await first.recordEntry(round);
    await first.recordConvergenceExit(round);

    const restarted = state("restart");
    await restarted.initialize();
    await expect(restarted.load()).resolves.toMatchObject({ clientActionId: "buy-1", state: "submitted" });
    await expect(restarted.hasEntry(round)).resolves.toBe(true);
    await expect(restarted.hasConvergenceExit(round)).resolves.toBe(true);
    await expect(restarted.hasEntry({ ...round, marketId: "btc-next-5m" })).resolves.toBe(false);
    await restarted.clear("different-action");
    await expect(restarted.load()).resolves.toBeDefined();
    await restarted.clear("buy-1");
    await expect(restarted.load()).resolves.toBeUndefined();
  });

  it("rejects a competing holder and permits handoff after release", async () => {
    const first = state("lease");
    const second = state("lease");
    await first.initialize();
    await second.initialize();
    const identity = { cluster: "mainnet-beta", wallet: "wallet", asset: "BTC", expiryFamily: "five_minute" } as const;
    const lease = await first.acquire(identity, "holder-1");
    expect(lease).toBeDefined();
    await expect(second.acquire(identity, "holder-2")).resolves.toBeUndefined();
    await expect(lease!.assertHeld()).resolves.toBeUndefined();
    await lease!.release();
    await expect(second.acquire(identity, "holder-2")).resolves.toBeDefined();
  });

  it("fails closed after lease ownership is lost", async () => {
    const first = state("loss");
    await first.initialize();
    const identity = { cluster: "devnet", wallet: "wallet", asset: "SOL", expiryFamily: "five_minute" } as const;
    const lease = await first.acquire(identity, "holder-1");
    expect(lease).toBeDefined();
    await pools.at(-1)!.query("update stryke_reference_bot_leases set holder_id = 'holder-2' where namespace = 'loss'");
    await expect(lease!.assertHeld()).rejects.toThrow("Runtime lease was lost");
  });

  it("allows takeover after expiry and rejects the stale holder", async () => {
    const first = state("expiry");
    const second = state("expiry");
    await first.initialize();
    const identity = { cluster: "mainnet-beta", wallet: "wallet", asset: "BTC", expiryFamily: "five_minute" } as const;
    const stale = await first.acquire(identity, "holder-1");
    expect(stale).toBeDefined();
    await pools.at(-2)!.query("update stryke_reference_bot_leases set expires_at = now() - interval '1 second' where namespace = 'expiry'");
    await expect(second.acquire(identity, "holder-2")).resolves.toBeDefined();
    await expect(stale!.assertHeld()).rejects.toThrow("Runtime lease was lost");
  });

  it("stops the composed loop before market work after lease loss", async () => {
    const store = state("composed-loss");
    await store.initialize();
    const identity = { cluster: "devnet", wallet: "wallet", asset: "BTC", expiryFamily: "five_minute" } as const;
    const lease = await store.acquire(identity, "holder-1");
    expect(lease).toBeDefined();
    await pools.at(-1)!.query("update stryke_reference_bot_leases set holder_id = 'holder-2' where namespace = 'composed-loss'");
    let marketCalls = 0;
    await expect(runReferenceBot({
      config: parseReferenceBotConfig({ killSwitchEnabled: false }),
      runtimeLease: lease!,
      once: true,
      adapter: {
        loadCheckpoint: async () => { marketCalls += 1; return undefined; },
        reconcilePending: async () => ({ state: "confirmed", clientActionId: "none" }),
        listPositions: async () => [],
        evaluatePosition: async () => { throw new Error("not reached"); },
        evaluateEntry: async () => { throw new Error("not reached"); },
        executeBuy: async () => ({}),
        executeSell: async () => ({}),
        executeTerminal: async () => ({}),
      },
    })).rejects.toThrow("runtime lease is unavailable or was lost");
    expect(marketCalls).toBe(0);
  });
});
