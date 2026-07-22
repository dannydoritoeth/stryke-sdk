import { describe, expect, it, vi } from "vitest";

import { parseReferenceBotConfig } from "../../examples/reference-bot/src/config.js";
import { decideEntry } from "../../examples/reference-bot/src/entry.js";
import {
  MemoryActionCheckpointStore,
  ReviewedTransactionExecutor,
  type ExecutableQuote,
} from "../../packages/sdk/src/index.js";
import { devnetRpc } from "./helpers.js";

const owner = "5SJTm7genD8XY5rxGrDVSwjUZwaqYeKRmhv8UxeZiCbY";
const transaction = (lastValidBlockHeight: bigint) => ({
  clientActionId: "pilot_failure_recovery_01",
  intentHash: `intent_v1_${"a".repeat(64)}`,
  recentBlockhash: "11111111111111111111111111111111",
  lastValidBlockHeight,
  review: { cluster: "devnet", programId: "GmXBVbwqBhjetu9VSbFoQQMHDi22WAMBn4oNwj9sjnSE", owner, market: {}, action: "buy", side: "yes", amount: "1000000" },
  transactionMessage: {},
  raw: {},
});

describe("fresh devnet failure recovery", () => {
  it("devnet_expired_quote_or_blockhash_requires_fresh_review", async () => {
    const height = BigInt(await devnetRpc<number>("getBlockHeight", [{ commitment: "confirmed" }]));
    const sign = vi.fn();
    const submit = vi.fn();
    const executor = new ReviewedTransactionExecutor(
      {} as never,
      new MemoryActionCheckpointStore(),
      { getBlockHeight: async () => height, sign, submit } as never
    );
    await expect(executor.execute(transaction(height - 1n) as never)).rejects.toMatchObject({ code: "blockhash_expired" });
    expect(sign).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("devnet_wallet_rejection_leaves_no_submitted_action", async () => {
    const height = BigInt(await devnetRpc<number>("getBlockHeight", [{ commitment: "confirmed" }]));
    const store = new MemoryActionCheckpointStore();
    const submit = vi.fn();
    const executor = new ReviewedTransactionExecutor(
      {} as never,
      store,
      {
        getBlockHeight: async () => height,
        simulate: async () => ({ ok: true }),
        sign: async () => { throw new Error("pilot wallet rejected"); },
        submit,
      } as never
    );
    await expect(executor.execute(transaction(height + 100n) as never)).rejects.toMatchObject({ code: "wallet_rejected" });
    expect(submit).not.toHaveBeenCalled();
    await expect(store.load()).resolves.toBeUndefined();
  });

  it("devnet_stale_pyth_blocks_decision_and_transaction", () => {
    const submit = vi.fn();
    const quote: ExecutableQuote = {
      quoteId: "devnet-stale",
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      marketStateVersion: "devnet",
      action: "buy",
      side: "yes",
      amount: "1000000",
      fee: "0",
      feeBreakdown: { feeMode: "waived", normalTradingFeeWaivedCollateralUnits: "0", grossTradeFeeCollateralUnits: "0", normalTradingFeeBps: 0, feeBpsApplied: 0 },
      expectedShares: "1000000",
      minimumOutput: "990000",
      maximumSlippageBpsApplied: 100,
      executableProbabilityBps: 4000,
      priceImpactBps: 10,
      raw: {},
    };
    const decision = decideEntry({
      fairProbability: 0.7,
      quote,
      config: parseReferenceBotConfig({ readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: false, walletAdapterPath: "./pilot-wallet-adapter.js" }),
      secondsRemaining: 120,
      tradeSizeSol: 0.01,
      aggregateExposureSol: 0,
      openPositions: 0,
      dataFresh: false,
    });
    if (decision.action === "buy") submit();
    expect(decision).toMatchObject({ action: "blocked", reason: "fresh" });
    expect(submit).not.toHaveBeenCalled();
  });
});
