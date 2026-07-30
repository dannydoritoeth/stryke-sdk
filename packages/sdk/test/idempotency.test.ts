import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FileActionCheckpointStore,
  MemoryActionCheckpointStore,
  ReviewedTransactionExecutor,
  StrykeSdkError,
  parsePilotPosition,
  terminalActionFor,
  type PilotActionReconciliation,
} from "../src/index.js";
import { positionRow } from "./position-fixtures.js";

const clientActionId = "pilot_action_restart_01";
const intentHash = `intent_v1_${"a".repeat(64)}`;
const signature = "7".repeat(64);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

const action = (
  state: PilotActionReconciliation["state"]
): PilotActionReconciliation => ({
  apiVersion: "v1",
  schemaVersion: "stryke.pilotAction.v1",
  clientActionId,
  intentHash,
  state,
  rawReason: state,
  ...(state === "not_submitted" ? {} : { signature }),
  observedAt: "2026-07-22T00:00:00.000Z",
  raw: {},
});

const harness = async (state: PilotActionReconciliation["state"]) => {
  const store = new MemoryActionCheckpointStore();
  const refreshed: unknown[] = [];
  const transactions = { reconcile: async () => action(state) };
  const adapter = {
    refresh: async (value: unknown) => {
      refreshed.push(value);
      return value;
    },
  };
  const executor = new ReviewedTransactionExecutor(
    transactions as never,
    store,
    adapter as never
  );
  return { store, refreshed, executor };
};

describe("restart-safe action checkpoints", () => {
  it("restart_after_prepare_reuses_client_action_id_without_submission", async () => {
    const { store, executor } = await harness("not_submitted");
    await store.save({ clientActionId, intentHash, state: "not_submitted" });
    await expect(executor.resume()).resolves.toMatchObject({ state: "not_submitted" });
    await expect(store.load()).resolves.toMatchObject({ clientActionId, intentHash });
  });

  it("restart_after_signature_reconciles_before_retry", async () => {
    const { store, executor } = await harness("submitted");
    await store.save({ clientActionId, intentHash, signature, state: "submitted" });
    await expect(executor.resume()).rejects.toMatchObject({ code: "duplicate_action" });
    await expect(store.load()).resolves.toMatchObject({ state: "submitted", signature });
  });

  it("unknown_signature_status_blocks_duplicate_trade", async () => {
    const { store, executor } = await harness("unknown");
    await store.save({ clientActionId, intentHash, signature, state: "submitted" });
    await expect(executor.resume()).rejects.toMatchObject({ code: "duplicate_action" });
    await expect(store.load()).resolves.toMatchObject({ state: "unknown" });
  });

  it("failed_or_expired_with_authoritative_evidence_allows_new_decision", async () => {
    for (const state of ["failed", "expired"] as const) {
      const { store, executor } = await harness(state);
      await store.save({ clientActionId, intentHash, signature, state: "submitted" });
      await expect(executor.resume()).resolves.toMatchObject({ state });
      await expect(store.load()).resolves.toBeUndefined();
    }
  });

  it("confirmed_trade_closes_checkpoint_and_refreshes_position", async () => {
    const { store, executor, refreshed } = await harness("confirmed");
    await store.save({ clientActionId, intentHash, signature, state: "submitted" });
    await expect(executor.resume()).resolves.toMatchObject({ state: "confirmed" });
    await expect(store.load()).resolves.toBeUndefined();
    expect(refreshed).toHaveLength(1);
  });

  it("confirmed_action_retries_transient_v2_materialization_before_clearing_checkpoint", async () => {
    const store = new MemoryActionCheckpointStore();
    let attempts = 0;
    const executor = new ReviewedTransactionExecutor(
      { reconcile: async () => action("confirmed") } as never,
      store,
      {
        refresh: async () => {
          attempts += 1;
          if (attempts < 3) {
            throw new StrykeSdkError(
              "source_stale",
              "Active position is awaiting authoritative V2 valuation",
              true
            );
          }
          return { valuation: "ready" };
        },
      } as never
    );
    await store.save({ clientActionId, intentHash, signature, state: "submitted" });
    await expect(executor.resume()).resolves.toMatchObject({ state: "confirmed" });
    expect(attempts).toBe(3);
    await expect(store.load()).resolves.toBeUndefined();
  });

  it("already_confirmed_claim_cannot_be_prepared_again", () => {
    const claimed = parsePilotPosition(positionRow("claimed"));
    expect(() => terminalActionFor(claimed)).toThrowError(
      expect.objectContaining({ code: "position_state" })
    );
  });

  it("atomic_checkpoint_never_exposes_partial_signature_state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stryke-checkpoint-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "action.json");
    const store = new FileActionCheckpointStore(path);
    await store.save({ clientActionId, intentHash, state: "not_submitted" });
    await store.save({ clientActionId, intentHash, signature, state: "submitted" });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      clientActionId,
      intentHash,
      signature,
      state: "submitted",
    });
    await expect(store.load()).resolves.toMatchObject({ signature, state: "submitted" });
  });
});
