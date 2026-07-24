import { describe, expect, it, vi } from "vitest";

import { executeReviewedLiveBuy } from "../src/live-runner.js";

const market = {
  assetRef: "btc-feed",
  tokenMint: "So11111111111111111111111111111111111111112",
  source: "pyth_oracle",
  expiryFamily: "five_minute",
  expiryTs: 1_800_000_000,
  strikePrice: "7000000000000",
  raw: { collateral: { symbol: "SOL" } },
};
const quote = { action: "buy", side: "yes", amount: "1000000" };
const prepared = { clientActionId: "live-test", intentHash: "intent_v1_test" };

const flow = (execute: (transaction: unknown) => Promise<unknown>) => ({
  pending: false,
  resume: vi.fn(async () => undefined),
  current: vi.fn(async () => market),
  buy: vi.fn(async () => quote),
  intent: vi.fn(async () => "intent_v1_test"),
  prepare: vi.fn(async () => prepared),
  execute: vi.fn(execute),
});

const input = (selectedFlow: ReturnType<typeof flow>) => ({
  flow: selectedFlow,
  owner: "pilot-owner",
  asset: "BTC" as const,
  expiryFamily: "five_minute" as const,
  side: "yes" as const,
  amount: "1000000",
  maximumSlippageBps: 100,
  clientActionId: "live-test",
});

describe("reference bot live runner", () => {
  it("live_runner_executes_reviewed_sdk_transaction_and_reconciles", async () => {
    const selectedFlow = flow(async () => ({ state: "confirmed", signature: "signature" }));

    await expect(executeReviewedLiveBuy(input(selectedFlow) as never)).resolves.toEqual({
      state: "confirmed",
      signature: "signature",
    });
    expect(selectedFlow.current).toHaveBeenCalledWith("BTC", "five_minute");
    expect(selectedFlow.intent).toHaveBeenCalledWith(expect.objectContaining({
      clientActionId: "live-test",
      owner: "pilot-owner",
      market: expect.objectContaining({ expiryFamily: "five_minute" }),
    }));
    expect(selectedFlow.execute).toHaveBeenCalledWith(prepared);
  });

  it("live_runner_keeps_wallet_rejection_unsubmitted", async () => {
    const rejection = Object.assign(new Error("Wallet rejected transaction signing"), {
      code: "wallet_rejected",
    });
    const selectedFlow = flow(async () => {
      throw rejection;
    });

    await expect(executeReviewedLiveBuy(input(selectedFlow) as never)).rejects.toMatchObject({
      code: "wallet_rejected",
    });
    expect(selectedFlow.execute).toHaveBeenCalledOnce();
    expect(selectedFlow.resume).not.toHaveBeenCalled();
  });
});
