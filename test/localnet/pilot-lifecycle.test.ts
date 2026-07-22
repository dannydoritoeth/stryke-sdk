import { describe, expect, it } from "vitest";

import {
  MemoryActionCheckpointStore,
  ReviewedTransactionExecutor,
  parsePilotPosition,
  terminalActionFor,
} from "../../packages/sdk/src/index.js";
import { positionRow } from "../../packages/sdk/test/position-fixtures.js";

const executeConfirmed = async (action: "buy" | "sell" | "claim" | "refund") => {
  const events: string[] = [];
  const transactions = {
    registerSubmission: async () => {
      events.push(`${action}:registered`);
      return {};
    },
  };
  const adapter = {
    getBlockHeight: async () => 1n,
    simulate: async () => ({ ok: true as const }),
    sign: async () => new Uint8Array([1]),
    submit: async () => "8".repeat(64),
    confirm: async () => ({ state: "confirmed" as const, observedSlot: 10 }),
    refresh: async () => {
      events.push(`${action}:refreshed`);
      return { action, lifecycle: "confirmed" };
    },
  };
  const result = await new ReviewedTransactionExecutor(
    transactions as never,
    new MemoryActionCheckpointStore(),
    adapter
  ).execute({
    clientActionId: `localnet_${action}_action_01`,
    intentHash: `intent_v1_${"a".repeat(64)}`,
    recentBlockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 2n,
    review: {
      cluster: "devnet",
      programId: "GmXBVbwqBhjetu9VSbFoQQMHDi22WAMBn4oNwj9sjnSE",
      owner: "HYDrCb45WNbMzLjKqQByKduksFCasUfgLNpkA7xvcxf7",
      market: {},
      action,
    },
    transactionMessage: {} as never,
    raw: {} as never,
  });
  expect(result.state).toBe("confirmed");
  expect(events).toEqual([`${action}:registered`, `${action}:refreshed`]);
};

describe("SDK lifecycle fixture paired with the minimal-Pyth local validator lane", () => {
  it("localnet_buy_confirm_reconcile_sell_confirm", async () => {
    await executeConfirmed("buy");
    await executeConfirmed("sell");
  });

  it("localnet_buy_resolve_claim_confirm", async () => {
    await executeConfirmed("buy");
    const claimable = parsePilotPosition(
      positionRow("claimable", { claimableAmount: "10" })
    );
    expect(terminalActionFor(claimable, Date.parse("2026-07-22T00:00:00Z"))).toBe("claim");
    await executeConfirmed("claim");
  });

  it("localnet_underfunded_or_zero_winner_refund_confirm", async () => {
    for (const rawReason of ["market_underfunded_refund", "settlement_zero_winner"]) {
      const refundable = parsePilotPosition(
        positionRow("refundable", {
          refundableAmount: "10",
          pilotLifecycle: {
            ...positionRow("refundable").pilotLifecycle,
            rawReason,
          },
        })
      );
      expect(terminalActionFor(refundable, Date.parse("2026-07-22T00:00:00Z"))).toBe("refund");
    }
    await executeConfirmed("refund");
  });
});
