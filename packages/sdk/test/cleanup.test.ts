import { describe, expect, it, vi } from "vitest";

import { CleanupClient, SUPPORTED_PROGRAM_ID } from "../src/index.js";

const owner = "DqAZKE675GJNhxJgTYYzZs6DAeGNZAmZ1GJX2CNbUfq1";
const position = "8pSVGYUpRxbmnRZ9u2CDnUXVgtneYvxiJ4M4XF7BQouH";

const response = (recipient = owner) => ({
  owner,
  collateral: { type: "native_sol", mint: "11111111111111111111111111111111", symbol: "SOL", decimals: 9 },
  action: "close_all",
  singleAction: "close",
  totalItems: 1,
  approvalCount: 1,
  chunks: [{
    index: 0,
    itemIds: ["close:item"],
    instructions: [{
      name: "close_user_position",
      programId: SUPPORTED_PROGRAM_ID,
      dataBase64: "b2lkv1J2zEAA",
      accounts: [
        { name: "processor", pubkey: owner, isSigner: true, isWritable: false },
        { name: "rent_recipient", pubkey: recipient, isSigner: false, isWritable: true },
        { name: "position", pubkey: position, isSigner: false, isWritable: true },
      ],
    }],
    rentQuote: {
      appSponsoredRecoverableLamports: "0",
      userRecoverableLamports: "2088000",
      userNonRecoverableLamports: "0",
      estimatedNetworkFeeLamports: "5000",
      estimatedPriorityFeeLamports: "0",
      recoverableRentItems: [{
        kind: "user_position",
        address: position,
        amountLamports: "2088000",
        recipient,
        recoveryCondition: "position_terminal_close",
      }],
    },
    transaction: {
      kind: "instruction_plan",
      feePayer: owner,
      recentBlockhashRequired: true,
      signers: [owner],
      programId: SUPPORTED_PROGRAM_ID,
      contractProfile: "minimal_pyth",
      cluster: "mainnet-beta",
    },
  }],
  items: [{
    id: "close:item",
    action: "close",
    market: {
      expiryTs: 1_800_000_000,
      targetValue: "70000",
      marketSeries: "series-1",
      strikeMarket: "strike-1",
    },
    chunkIndex: 0,
  }],
  metadata: { stale: false, environment: { solanaCluster: "mainnet-beta" } },
});

const client = (body: unknown) => ({
  capabilities: { cluster: "mainnet-beta", contract: { programId: SUPPORTED_PROGRAM_ID } },
  requestJson: vi.fn(async () => body),
});
const rpc = {
  getLatestBlockhash: () => ({
    send: async () => ({ value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 123n } }),
  }),
};

describe("wallet rent cleanup", () => {
  it("validates and materializes an API-authoritative close_all plan", async () => {
    const api = client(response());
    const plan = await new CleanupClient(api as never, rpc).prepareAll(owner);
    expect(api.requestJson).toHaveBeenCalledWith(
      `/v1/portfolio/${owner}/actions/transaction-prep`,
      expect.objectContaining({ method: "POST" })
    );
    expect(plan).toMatchObject({
      owner,
      totalRecoverableLamports: "2088000",
      totalEstimatedNetworkFeeLamports: "5000",
      transactions: [{ review: {
        action: "close",
        owner,
        positionAddresses: [position],
        market: { cleanupItems: [{ id: "close:item", market: { marketSeries: "series-1" } }] },
      } }],
    });
  });

  it("fails closed when rent is redirected away from the signer", async () => {
    await expect(
      new CleanupClient(client(response("11111111111111111111111111111111")) as never, rpc).prepareAll(owner)
    ).rejects.toMatchObject({ code: "intent_mismatch" });
  });

  it("fails closed when the recoverable total is not backed by item quotes", async () => {
    const mismatched = response();
    mismatched.chunks[0]!.rentQuote.userRecoverableLamports = "2088001";
    await expect(
      new CleanupClient(client(mismatched) as never, rpc).prepareAll(owner)
    ).rejects.toMatchObject({ code: "intent_mismatch" });
  });

  it("fails closed when a chunk references an item assigned to another chunk", async () => {
    const mismatched = response();
    mismatched.items[0]!.chunkIndex = 1;
    await expect(
      new CleanupClient(client(mismatched) as never, rpc).prepareAll(owner)
    ).rejects.toMatchObject({ code: "intent_mismatch" });
  });
});
