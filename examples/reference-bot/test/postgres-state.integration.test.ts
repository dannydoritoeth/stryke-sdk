import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresReferenceBotState } from "../src/postgres-state.js";

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

  it("persists checkpoints and round decisions across store instances", async () => {
    const first = state("restart");
    await first.initialize();
    await first.save({ clientActionId: "buy-1", intentHash: "intent-1", state: "submitted" });
    const round = { marketId: "btc-5m", expiryTs: 1_800_000_000, strikePrice: "70000" };
    await first.recordEntry(round);

    const restarted = state("restart");
    await restarted.initialize();
    await expect(restarted.load()).resolves.toMatchObject({ clientActionId: "buy-1", state: "submitted" });
    await expect(restarted.hasEntry(round)).resolves.toBe(true);
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
});
