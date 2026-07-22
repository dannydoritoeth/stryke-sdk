import { describe, expect, it } from "vitest";

import {
  createPilotIntentHash,
  MemoryActionCheckpointStore,
  ReviewedTransactionExecutor,
  SUPPORTED_PROGRAM_ID,
  TransactionsClient,
  type ExecutableQuote,
  type PilotMarket,
} from "../src/index.js";

const owner = "HYDrCb45WNbMzLjKqQByKduksFCasUfgLNpkA7xvcxf7";
const now = Date.parse("2026-07-22T00:00:00.000Z");
const market: PilotMarket = {
  marketId: "pilot-market",
  asset: "BTC",
  assetRef: "So11111111111111111111111111111111111111112",
  source: "pyth_oracle",
  collateral: "SOL",
  expiryFamily: "five_minute",
  expiryTs: 1_800_000_000,
  strikePrice: "7000000000000",
  status: "open",
  rawStatus: "active",
  generatedAt: new Date(now).toISOString(),
  lifecycle: {
    schemaVersion: "stryke.pilotLifecycle.v1",
    state: "open",
    rawStatus: "active",
    rawReason: "market_open",
    observedAt: new Date(now).toISOString(),
  },
  tradeability: {
    canQuote: true,
    canPrepareTransaction: true,
    disabledReasons: [],
  },
  stale: false,
  raw: {
    tokenMint: "So11111111111111111111111111111111111111112",
    collateral: {
      type: "native_sol",
      mint: "11111111111111111111111111111111",
      symbol: "SOL",
      decimals: 9,
    },
  },
};
const quote: ExecutableQuote = {
  quoteId: "quote-1",
  generatedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 5_000).toISOString(),
  marketStateVersion: "state-1",
  action: "buy",
  side: "yes",
  amount: "1000000000",
  fee: "10000000",
  feeBreakdown: {
    feeMode: "standard",
    normalTradingFeeWaivedCollateralUnits: "0",
    grossTradeFeeCollateralUnits: "10000000",
    normalTradingFeeBps: 100,
    feeBpsApplied: 100,
  },
  expectedShares: "1250000000",
  minimumOutput: "1237500000",
  maximumSlippageBpsApplied: 100,
  executableProbabilityBps: 8000,
  priceImpactBps: 25,
  raw: {},
};

const prep = {
  clientActionId: "pilot_action_00000001",
  intentHash: `intent_v1_${"a".repeat(64)}`,
  quoteBinding: {
    quoteId: quote.quoteId,
    generatedAt: quote.generatedAt,
    expiresAt: quote.expiresAt,
    marketStateVersion: quote.marketStateVersion,
    minimumOutput: quote.minimumOutput,
    maximumSlippageBpsApplied: quote.maximumSlippageBpsApplied,
  },
  owner,
  market: {
    tokenMint: market.assetRef,
    source: market.source,
    collateral: market.raw.collateral,
    expiryFamily: market.expiryFamily,
    expiryTs: market.expiryTs,
    targetValue: market.strikePrice,
    marketSeries: "11111111111111111111111111111111",
    strikeMarket: "So11111111111111111111111111111111111111112",
  },
  action: "buy",
  side: "yes",
  instructions: [
    {
      name: "buy_yes",
      programId: SUPPORTED_PROGRAM_ID,
      dataBase64: "AQID",
      accounts: [
        { pubkey: owner, isSigner: true, isWritable: true },
      ],
    },
  ],
  transaction: {
    kind: "instruction_plan",
    feePayer: owner,
    recentBlockhashRequired: true,
    signers: [owner],
    programId: SUPPORTED_PROGRAM_ID,
    contractProfile: "minimal_pyth",
    cluster: "devnet",
  },
  metadata: { environment: { solanaCluster: "devnet" } },
};

describe("pilot transaction materialization", () => {
  it("creates the API-compatible exact intent hash", async () => {
    const marketIdentity = {
      tokenMint: market.assetRef,
      source: market.source,
      collateral: market.raw.collateral,
      expiryFamily: market.expiryFamily,
      expiryTs: market.expiryTs,
      targetValue: market.strikePrice,
    };
    const digest = await createPilotIntentHash({
      clientActionId: prep.clientActionId,
      owner,
      market: marketIdentity,
      quote,
    });
    expect(digest).toMatch(/^intent_v1_[a-f0-9]{64}$/);
    await expect(
      createPilotIntentHash({
        clientActionId: prep.clientActionId,
        owner,
        market: { ...marketIdentity, targetValue: "changed" },
        quote,
      })
    ).resolves.not.toBe(digest);
  });

  it("materialized_transaction_exposes_blockhash_validity", async () => {
    const intentHash = await createPilotIntentHash({
      clientActionId: prep.clientActionId,
      owner,
      market: {
        tokenMint: market.assetRef,
        source: market.source,
        collateral: market.raw.collateral,
        expiryFamily: market.expiryFamily,
        expiryTs: market.expiryTs,
        targetValue: market.strikePrice,
      },
      quote,
    });
    const client = {
      capabilities: { contract: { programId: SUPPORTED_PROGRAM_ID } },
      requestJson: async () => ({ ...prep, intentHash }),
    };
    const rpc = {
      getLatestBlockhash: () => ({
        send: async () => ({
          value: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 1234n,
          },
        }),
      }),
    };
    const result = await new TransactionsClient(
      client as never,
      rpc,
      () => now
    ).prepare({
      owner,
      market,
      quote,
      clientActionId: prep.clientActionId,
      intentHash,
    });

    expect(result).toMatchObject({
      clientActionId: prep.clientActionId,
      intentHash,
      recentBlockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 1234n,
      quoteId: quote.quoteId,
      marketStateVersion: quote.marketStateVersion,
      minimumOutput: quote.minimumOutput,
    });
    expect(result.transactionMessage.instructions).toHaveLength(1);
    expect(result.transactionMessage.lifetimeConstraint).toMatchObject({
      lastValidBlockHeight: 1234n,
    });
  });

  it("prep_rejects_owner_cluster_program_market_action_side_or_amount_mismatch", async () => {
    const intentHash = await createPilotIntentHash({
      clientActionId: prep.clientActionId,
      owner,
      market: {
        tokenMint: market.assetRef,
        source: market.source,
        collateral: market.raw.collateral,
        expiryFamily: market.expiryFamily,
        expiryTs: market.expiryTs,
        targetValue: market.strikePrice,
      },
      quote,
    });
    const rpc = { getLatestBlockhash: () => ({ send: async () => { throw new Error("RPC must not be called"); } }) };
    const responses = [
      { ...prep, intentHash, owner: "Different11111111111111111111111111111111111" },
      { ...prep, intentHash, action: "sell" },
      { ...prep, intentHash, side: "no" },
      { ...prep, intentHash, market: { ...prep.market, targetValue: "changed" } },
      { ...prep, intentHash, metadata: { environment: { solanaCluster: "localnet" } } },
      { ...prep, intentHash, transaction: { ...prep.transaction, programId: "11111111111111111111111111111111" } },
    ];
    for (const response of responses) {
      const client = {
        capabilities: { contract: { programId: SUPPORTED_PROGRAM_ID } },
        requestJson: async () => response,
      };
      await expect(
        new TransactionsClient(client as never, rpc, () => now).prepare({
          owner,
          market,
          quote,
          clientActionId: prep.clientActionId,
          intentHash,
        })
      ).rejects.toMatchObject({ code: "intent_mismatch" });
    }
    const changedAmountQuote = { ...quote, amount: "2" };
    await expect(
      new TransactionsClient({ requestJson: async () => prep } as never, rpc, () => now).prepare({
        owner,
        market,
        quote: changedAmountQuote,
        clientActionId: prep.clientActionId,
        intentHash,
      })
    ).rejects.toMatchObject({ code: "intent_mismatch" });
  });

  it("prep_rejects_quote_id_state_version_or_minimum_output_mismatch", async () => {
    const intentHash = await createPilotIntentHash({
      clientActionId: prep.clientActionId,
      owner,
      market: {
        tokenMint: market.assetRef,
        source: market.source,
        collateral: market.raw.collateral,
        expiryFamily: market.expiryFamily,
        expiryTs: market.expiryTs,
        targetValue: market.strikePrice,
      },
      quote,
    });
    for (const quoteBinding of [
      { ...prep.quoteBinding, quoteId: "changed" },
      { ...prep.quoteBinding, marketStateVersion: "changed" },
      { ...prep.quoteBinding, minimumOutput: "1" },
    ]) {
      const client = {
        capabilities: { contract: { programId: SUPPORTED_PROGRAM_ID } },
        requestJson: async () => ({ ...prep, intentHash, quoteBinding }),
      };
      await expect(
        new TransactionsClient(client as never, {} as never, () => now).prepare({
          owner,
          market,
          quote,
          clientActionId: prep.clientActionId,
          intentHash,
        })
      ).rejects.toMatchObject({ code: "intent_mismatch" });
    }
  });

  it("expired_quote_requires_fresh_quote_before_prep", async () => {
    const client = { requestJson: async () => { throw new Error("API must not be called"); } };
    await expect(
      new TransactionsClient(client as never, {} as never, () => now + 5_000).prepare({
        owner,
        market,
        quote,
        clientActionId: prep.clientActionId,
        intentHash: prep.intentHash,
      })
    ).rejects.toMatchObject({ code: "quote_blocked" });
  });

  it("registers and reconciles action state through explicit v1 routes", async () => {
    const calls: string[] = [];
    const actionResponse = {
      apiVersion: "v1",
      schemaVersion: "stryke.pilotAction.v1",
      clientActionId: prep.clientActionId,
      intentHash: prep.intentHash,
      state: "submitted",
      rawReason: "signature_registered",
      signature: "7".repeat(64),
      observedAt: new Date(now).toISOString(),
    };
    const client = {
      capabilities: { contract: { programId: SUPPORTED_PROGRAM_ID } },
      requestJson: async (path: string) => {
        calls.push(path);
        return actionResponse;
      },
    };
    const transactions = new TransactionsClient(client as never, {} as never);
    await expect(
      transactions.registerSubmission({
        clientActionId: prep.clientActionId,
        intentHash: prep.intentHash,
        signature: actionResponse.signature,
      })
    ).resolves.toMatchObject({ state: "submitted", rawReason: "signature_registered" });
    await expect(transactions.reconcile(prep.clientActionId)).resolves.toMatchObject({
      clientActionId: prep.clientActionId,
      state: "submitted",
    });
    expect(calls).toEqual([
      `/v1/pilot/actions/${prep.clientActionId}/submission`,
      `/v1/pilot/actions/${prep.clientActionId}`,
    ]);
  });
});

const executionTransaction = {
  clientActionId: prep.clientActionId,
  intentHash: prep.intentHash,
  quoteId: quote.quoteId,
  marketStateVersion: quote.marketStateVersion,
  minimumOutput: quote.minimumOutput,
  recentBlockhash: "11111111111111111111111111111111",
  lastValidBlockHeight: 100n,
  review: {
    cluster: "devnet",
    programId: SUPPORTED_PROGRAM_ID,
    owner,
    market: prep.market,
    action: "buy",
    side: "yes",
    amount: quote.amount,
  },
  transactionMessage: {},
  raw: prep,
} as never;

const executionHarness = (overrides: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  const transactions = {
    registerSubmission: async () => {
      calls.push("register");
      return {};
    },
    reconcile: async () => ({ state: "not_submitted" }),
  };
  const adapter = {
    getBlockHeight: async () => 99n,
    simulate: async () => ({ ok: true as const }),
    sign: async () => {
      calls.push("sign");
      return new Uint8Array([1]);
    },
    submit: async () => {
      calls.push("submit");
      return "8".repeat(64);
    },
    confirm: async () => ({ state: "unknown" as const, reason: "pending" }),
    refresh: async () => {
      calls.push("refresh");
      return { position: "refreshed" };
    },
    ...overrides,
  };
  const checkpoint = new MemoryActionCheckpointStore();
  return {
    calls,
    checkpoint,
    executor: new ReviewedTransactionExecutor(
      transactions as never,
      checkpoint,
      adapter as never
    ),
  };
};

describe("reviewed transaction execution", () => {
  it("expired_blockhash_never_submits", async () => {
    const { executor, calls } = executionHarness({ getBlockHeight: async () => 101n });
    await expect(executor.execute(executionTransaction)).rejects.toMatchObject({
      code: "blockhash_expired",
    });
    expect(calls).not.toContain("submit");
  });

  it("wallet_rejection_returns_terminal_typed_result", async () => {
    const { executor, calls, checkpoint } = executionHarness({
      sign: async () => {
        calls.push("sign");
        throw new Error("rejected");
      },
    });
    await expect(executor.execute(executionTransaction)).rejects.toMatchObject({
      code: "wallet_rejected",
    });
    expect(calls).not.toContain("submit");
    await expect(checkpoint.load()).resolves.toBeUndefined();
  });

  it("simulation_failure_never_requests_submission", async () => {
    const { executor, calls } = executionHarness({
      simulate: async () => ({ ok: false as const, reason: "simulation failed" }),
    });
    await expect(executor.execute(executionTransaction)).rejects.toMatchObject({
      code: "simulation_failed",
    });
    expect(calls).toEqual([]);
  });

  it("submission_failure_preserves_unknown_checkpoint_and_blocks_retry", async () => {
    const { executor, checkpoint } = executionHarness({
      submit: async () => {
        throw new Error("transport closed");
      },
    });
    await expect(executor.execute(executionTransaction)).rejects.toMatchObject({
      code: "submission_failed",
    });
    await expect(checkpoint.load()).resolves.toMatchObject({ state: "unknown" });
  });

  it("confirmation_timeout_is_typed_and_preserves_signature", async () => {
    const { executor, checkpoint } = executionHarness({
      confirm: async () => {
        throw new Error("timeout");
      },
    });
    await expect(executor.execute(executionTransaction)).rejects.toMatchObject({
      code: "confirmation_timeout",
    });
    await expect(checkpoint.load()).resolves.toMatchObject({
      state: "unknown",
      signature: "8".repeat(64),
    });
  });

  it("authoritative_confirmation_expiry_closes_checkpoint", async () => {
    const { executor, checkpoint } = executionHarness({
      confirm: async () => ({ state: "expired" as const, reason: "block height exceeded" }),
    });
    await expect(executor.execute(executionTransaction)).resolves.toMatchObject({
      state: "expired",
    });
    await expect(checkpoint.load()).resolves.toBeUndefined();
  });

  it("signature_received_is_not_reported_as_confirmed", async () => {
    const { executor, checkpoint } = executionHarness();
    await expect(executor.execute(executionTransaction)).resolves.toMatchObject({
      signature: "8".repeat(64),
      state: "unknown",
    });
    await expect(checkpoint.load()).resolves.toMatchObject({ state: "unknown" });
  });

  it("confirmed_transaction_refreshes_position_and_activity", async () => {
    const { executor, calls, checkpoint } = executionHarness({
      confirm: async () => ({ state: "confirmed" as const, observedSlot: 123 }),
    });
    await expect(executor.execute(executionTransaction)).resolves.toMatchObject({
      state: "confirmed",
      refreshed: { position: "refreshed" },
    });
    expect(calls).toContain("refresh");
    await expect(checkpoint.load()).resolves.toBeUndefined();
  });
});
