import type { ActionCheckpoint, ActionCheckpointStore } from "@stryketrade/sdk";
import { Pool, type PoolConfig } from "pg";

import { roundKey, type PositionRoundIdentity, type RoundDecisionStore, type RoundIdentity } from "./round-state.js";
import type { RuntimeLease, RuntimeLeaseIdentity, RuntimeLeaseStore } from "./runtime-lease.js";
import type { ReferenceBotConfig } from "./config.js";

export const referenceBotPostgresPoolConfig = (
  config: ReferenceBotConfig
): PoolConfig => ({
  connectionString: config.stateDatabaseUrl,
  max: config.stateDatabasePoolMax,
  connectionTimeoutMillis: config.stateDatabasePoolConnectionTimeoutMs,
  idleTimeoutMillis: config.stateDatabasePoolIdleTimeoutMs,
  maxLifetimeSeconds: config.stateDatabasePoolMaxLifetimeSeconds,
  application_name: "stryke-reference-bot",
});

const identityKey = (identity: RuntimeLeaseIdentity) =>
  [identity.cluster, identity.wallet, identity.asset, identity.expiryFamily].join(":");

export class PostgresReferenceBotState
  implements ActionCheckpointStore, RoundDecisionStore, RuntimeLeaseStore
{
  private readonly pool: Pool;

  constructor(
    config: PoolConfig | Pool,
    private readonly namespace: string,
    private readonly leaseTtlMs = 30_000
  ) {
    this.pool = config instanceof Pool ? config : new Pool(config);
    if (!namespace || leaseTtlMs < 5_000) throw new Error("Invalid Postgres reference-bot state configuration");
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext('stryke_reference_bot_schema_v1'))");
      await client.query(`
        create table if not exists stryke_reference_bot_state (
          namespace text not null,
          state_key text not null,
          value jsonb not null,
          updated_at timestamptz not null default now(),
          primary key (namespace, state_key)
        );
        create table if not exists stryke_reference_bot_leases (
          namespace text not null,
          lease_key text not null,
          holder_id text not null,
          expires_at timestamptz not null,
          updated_at timestamptz not null default now(),
          primary key (namespace, lease_key)
        );
      `);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async load(): Promise<ActionCheckpoint | undefined> {
    const result = await this.pool.query<{ value: ActionCheckpoint }>(
      "select value from stryke_reference_bot_state where namespace = $1 and state_key = 'checkpoint'",
      [this.namespace]
    );
    return result.rows[0]?.value;
  }

  async save(checkpoint: ActionCheckpoint): Promise<void> {
    await this.pool.query(
      `insert into stryke_reference_bot_state (namespace, state_key, value) values ($1, 'checkpoint', $2::jsonb)
       on conflict (namespace, state_key) do update set value = excluded.value, updated_at = now()`,
      [this.namespace, JSON.stringify(checkpoint)]
    );
  }

  async clear(expectedClientActionId: string): Promise<void> {
    await this.pool.query(
      `delete from stryke_reference_bot_state
       where namespace = $1 and state_key = 'checkpoint' and value->>'clientActionId' = $2`,
      [this.namespace, expectedClientActionId]
    );
  }

  private async hasRound(kind: "entry" | "exit", round: RoundIdentity): Promise<boolean> {
    const result = await this.pool.query(
      "select 1 from stryke_reference_bot_state where namespace = $1 and state_key = $2",
      [this.namespace, `round:${kind}:${roundKey(round)}`]
    );
    return result.rowCount === 1;
  }

  private async recordRound(kind: "entry" | "exit", round: RoundIdentity): Promise<void> {
    await this.pool.query(
      `insert into stryke_reference_bot_state (namespace, state_key, value) values ($1, $2, $3::jsonb)
       on conflict (namespace, state_key) do nothing`,
      [this.namespace, `round:${kind}:${roundKey(round)}`, JSON.stringify(round)]
    );
  }

  hasConvergenceExit(round: RoundIdentity) { return this.hasRound("exit", round); }
  recordConvergenceExit(round: RoundIdentity) { return this.recordRound("exit", round); }
  hasEntry(round: RoundIdentity) { return this.hasRound("entry", round); }
  recordEntry(round: RoundIdentity) { return this.recordRound("entry", round); }
  async hasPreFeeRevalidation(identity: PositionRoundIdentity) {
    const result = await this.pool.query("select 1 from stryke_reference_bot_state where namespace = $1 and state_key = $2", [this.namespace, `pre-fee:${roundKey(identity)}:${identity.positionId}`]);
    return result.rowCount === 1;
  }
  async recordPreFeeRevalidation(identity: PositionRoundIdentity, outcome: string) {
    await this.pool.query(`insert into stryke_reference_bot_state (namespace, state_key, value) values ($1, $2, $3::jsonb) on conflict (namespace, state_key) do nothing`, [this.namespace, `pre-fee:${roundKey(identity)}:${identity.positionId}`, JSON.stringify({ ...identity, outcome })]);
  }

  async acquire(identity: RuntimeLeaseIdentity, holderId: string): Promise<RuntimeLease | undefined> {
    const leaseKey = identityKey(identity);
    const result = await this.pool.query(
      `insert into stryke_reference_bot_leases (namespace, lease_key, holder_id, expires_at)
       values ($1, $2, $3, now() + ($4 * interval '1 millisecond'))
       on conflict (namespace, lease_key) do update
       set holder_id = excluded.holder_id, expires_at = excluded.expires_at, updated_at = now()
       where stryke_reference_bot_leases.expires_at <= now()
          or stryke_reference_bot_leases.holder_id = excluded.holder_id
       returning holder_id`,
      [this.namespace, leaseKey, holderId, this.leaseTtlMs]
    );
    if (result.rowCount !== 1) return undefined;
    let lost: unknown;
    let released = false;
    let renewing: Promise<void> | undefined;
    const renew = async () => {
      if (released) throw new Error("Runtime lease was released");
      if (lost) throw lost;
      if (!renewing) {
        renewing = this.pool.query(
          `update stryke_reference_bot_leases
           set expires_at = now() + ($4 * interval '1 millisecond'), updated_at = now()
           where namespace = $1 and lease_key = $2 and holder_id = $3 and expires_at > now()
           returning holder_id`,
          [this.namespace, leaseKey, holderId, this.leaseTtlMs]
        ).then((renewed) => {
          if (renewed.rowCount !== 1) throw new Error("Runtime lease was lost");
        }).catch((error: unknown) => {
          lost = error;
          throw error;
        }).finally(() => {
          renewing = undefined;
        });
      }
      await renewing;
    };
    const renewalTimer = setInterval(() => {
      void renew().catch(() => {
        // The recurring loop observes the stored loss before its next market tick.
      });
    }, Math.max(1_000, Math.floor(this.leaseTtlMs / 3)));
    renewalTimer.unref();
    return {
      identity,
      holderId,
      assertHeld: renew,
      release: async () => {
        released = true;
        clearInterval(renewalTimer);
        if (renewing) await renewing.catch(() => undefined);
        await this.pool.query(
          "delete from stryke_reference_bot_leases where namespace = $1 and lease_key = $2 and holder_id = $3",
          [this.namespace, leaseKey, holderId]
        );
      },
    };
  }

  async close(): Promise<void> { await this.pool.end(); }
}
