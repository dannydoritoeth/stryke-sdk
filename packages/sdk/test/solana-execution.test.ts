import {
  address,
  blockhash,
  createTransactionMessage,
  generateKeyPairSigner,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { describe, expect, it, vi } from "vitest";

import {
  SolanaReviewedExecutionAdapter,
  type MaterializedPilotTransaction,
  type SolanaExecutionRpc,
} from "../src/index.js";

const rpcRequest = <T>(value: T) => ({ send: vi.fn(async () => value) });

const transactionFor = (
  owner: string,
  feePayer = owner
): MaterializedPilotTransaction => ({
  clientActionId: "adapter-test",
  intentHash: "intent_v1_adapter",
  recentBlockhash: "11111111111111111111111111111111",
  lastValidBlockHeight: 101n,
  review: {
    cluster: "devnet",
    programId: "GmXbYzVwBGk2e5FJB8hEvgjT9nbGJ3eE6XwXpnYjnSE",
    owner,
    market: {},
    action: "buy",
    side: "yes",
    amount: "1",
  },
  transactionMessage: setTransactionMessageLifetimeUsingBlockhash(
    {
      blockhash: blockhash("11111111111111111111111111111111"),
      lastValidBlockHeight: 101n,
    },
    setTransactionMessageFeePayer(
      address(feePayer),
      createTransactionMessage({ version: 0 })
    )
  ) as MaterializedPilotTransaction["transactionMessage"],
  raw: {
    transaction: { feePayer },
  } as MaterializedPilotTransaction["raw"],
});

const adapterRpc = (): SolanaExecutionRpc => ({
  getBlockHeight: () => rpcRequest(100n),
  simulateTransaction: () => rpcRequest({ value: { err: null } }),
  sendTransaction: () => rpcRequest("1".repeat(64)),
  getSignatureStatuses: () =>
    rpcRequest({
      value: [{ slot: 55n, err: null, confirmationStatus: "confirmed" as const }],
    }),
});

describe("SolanaReviewedExecutionAdapter", () => {
  it("solana_adapter_rejects_owner_or_fee_payer_signer_mismatch", async () => {
    const signer = await generateKeyPairSigner();
    const other = await generateKeyPairSigner();
    const adapter = new SolanaReviewedExecutionAdapter({
      rpc: adapterRpc(),
      signer,
      refresh: async () => undefined,
    });

    await expect(adapter.simulate(transactionFor(other.address))).rejects.toMatchObject({
      code: "configuration",
    });
    await expect(
      adapter.simulate(transactionFor(signer.address, other.address))
    ).rejects.toMatchObject({ code: "configuration" });
  });

  it("solana_adapter_simulates_signs_submits_and_confirms", async () => {
    const signer = await generateKeyPairSigner();
    const rpc = adapterRpc();
    const refresh = vi.fn(async () => ({ positions: [] }));
    const adapter = new SolanaReviewedExecutionAdapter({
      rpc,
      signer,
      refresh,
      confirmationPollIntervalMs: 0,
    });
    const transaction = transactionFor(signer.address);

    await expect(adapter.simulate(transaction)).resolves.toEqual({ ok: true });
    const signed = await adapter.sign(transaction);
    expect(signed).toBeInstanceOf(Uint8Array);
    await expect(adapter.submit(signed)).resolves.toBe("1".repeat(64));
    await expect(
      adapter.confirm({ signature: "1".repeat(64), lastValidBlockHeight: 101n })
    ).resolves.toEqual({ state: "confirmed", observedSlot: 55 });
    await expect(
      adapter.refresh({ clientActionId: "adapter-test", signature: "1".repeat(64) })
    ).resolves.toEqual({ positions: [] });
  });

  it("solana_adapter_maps_runtime_failure_without_secret_output", async () => {
    const signer = await generateKeyPairSigner();
    const adapter = new SolanaReviewedExecutionAdapter({
      rpc: {
        ...adapterRpc(),
        simulateTransaction: () => rpcRequest({ value: { err: { InstructionError: [0, "Custom"] } } }),
        getSignatureStatuses: () =>
          rpcRequest({ value: [{ slot: 56n, err: { InstructionError: [0, 1] }, confirmationStatus: "confirmed" }] }),
      },
      signer,
      refresh: async () => undefined,
    });

    await expect(adapter.simulate(transactionFor(signer.address))).resolves.toEqual({
      ok: false,
      reason: "Solana transaction simulation failed",
    });
    await expect(
      adapter.confirm({ signature: "1".repeat(64), lastValidBlockHeight: 101n })
    ).resolves.toEqual({ state: "failed", reason: "Solana transaction failed" });
  });
});
