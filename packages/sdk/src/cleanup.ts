import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  createTransactionMessage,
  getBase64Encoder,
  isAddress,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
} from "@solana/kit";

import type { StrykeClient } from "./client.js";
import { StrykeSdkError } from "./errors.js";
import type { LatestBlockhashRpc } from "./transactions.js";

type CleanupInstruction = {
  name: string;
  programId: string;
  dataBase64: string;
  accounts: Array<{ name: string; pubkey: string; isSigner: boolean; isWritable: boolean }>;
};

type CleanupTransactionContract = {
  kind: "instruction_plan";
  feePayer: string;
  recentBlockhashRequired: true;
  signers: string[];
  programId: string;
  contractProfile: "minimal_pyth";
  cluster: string;
};

type CleanupResponse = {
  owner: string;
  collateral: { type: string; mint: string; symbol: string; decimals: number };
  action: "close_all";
  singleAction: "close";
  totalItems: number;
  approvalCount: number;
  chunks: Array<{
    index: number;
    itemIds: string[];
    instructions: CleanupInstruction[];
    rentQuote: {
      appSponsoredRecoverableLamports: string;
      userRecoverableLamports: string;
      userNonRecoverableLamports: string;
      estimatedNetworkFeeLamports: string;
      estimatedPriorityFeeLamports: string;
      recoverableRentItems: Array<{
        kind: "user_position";
        address: string;
        amountLamports: string;
        recipient: string;
        recoveryCondition: "position_terminal_close";
      }>;
    };
    transaction: CleanupTransactionContract;
  }>;
  items: Array<{ id: string; action: "close"; market: Record<string, unknown>; chunkIndex: number }>;
  metadata: { stale: boolean; environment: { solanaCluster: string } };
};

const units = (value: unknown, field: string): bigint => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new StrykeSdkError("api_response", `Invalid cleanup amount: ${field}`);
  }
  return BigInt(value);
};

const accountRole = (account: CleanupInstruction["accounts"][number]): AccountRole =>
  account.isSigner
    ? account.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER
    : account.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;

const materialize = (instructions: CleanupInstruction[]): Instruction[] =>
  instructions.map((instruction) => ({
    programAddress: address(instruction.programId),
    accounts: instruction.accounts.map((account) => ({
      address: address(account.pubkey),
      role: accountRole(account),
    })),
    data: getBase64Encoder().encode(instruction.dataBase64),
  }));

export type MaterializedCleanupTransaction = {
  clientActionId: string;
  intentHash: string;
  recentBlockhash: string;
  lastValidBlockHeight: bigint;
  review: {
    cluster: string;
    programId: string;
    owner: string;
    market: {
      cleanupItems: Array<{ id: string; market: Readonly<Record<string, unknown>> }>;
    };
    action: "close";
    recoverableLamports: string;
    estimatedNetworkFeeLamports: string;
    positionAddresses: string[];
  };
  transactionMessage: ReturnType<typeof appendTransactionMessageInstructions>;
  raw: { transaction: CleanupTransactionContract };
};

export type CleanupPlan = {
  owner: string;
  totalRecoverableLamports: string;
  totalEstimatedNetworkFeeLamports: string;
  transactions: MaterializedCleanupTransaction[];
};

const createCleanupIntentHash = async (value: unknown): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value))
  );
  return `cleanup_v1_${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
};

export class CleanupClient {
  constructor(
    private readonly client: StrykeClient,
    private readonly rpc: LatestBlockhashRpc
  ) {}

  async prepareAll(owner: string, collateral: "SOL" = "SOL"): Promise<CleanupPlan> {
    if (!isAddress(owner)) {
      throw new StrykeSdkError("validation", "Cleanup owner is not a Solana address");
    }
    const response = await this.client.requestJson<CleanupResponse>(
      `/v1/portfolio/${encodeURIComponent(owner)}/actions/transaction-prep`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner, collateral, action: "close_all" }),
      }
    );
    if (
      response.owner !== owner ||
      response.action !== "close_all" ||
      response.singleAction !== "close" ||
      response.collateral.symbol !== collateral ||
      response.metadata.stale ||
      response.metadata.environment.solanaCluster !== this.client.capabilities.cluster ||
      response.totalItems !== response.items.length ||
      response.approvalCount !== response.chunks.length
    ) {
      throw new StrykeSdkError(
        "intent_mismatch",
        "Cleanup plan identity does not match the reviewed request"
      );
    }

    const itemIds = response.items.map((item) => item.id);
    if (
      new Set(itemIds).size !== itemIds.length ||
      response.items.some((item) =>
        item.action !== "close" ||
        !Number.isSafeInteger(item.chunkIndex) ||
        item.chunkIndex < 0 ||
        item.chunkIndex >= response.chunks.length
      )
    ) {
      throw new StrykeSdkError(
        "intent_mismatch",
        "Cleanup items do not match the reviewed close plan"
      );
    }
    const itemsById = new Map(response.items.map((item) => [item.id, item]));

    const transactions: MaterializedCleanupTransaction[] = [];
    for (const chunk of response.chunks) {
      const cleanupItems = chunk.itemIds.map((id) => itemsById.get(id));
      const recoverable = units(
        chunk.rentQuote.userRecoverableLamports,
        "userRecoverableLamports"
      );
      const networkFee = units(
        chunk.rentQuote.estimatedNetworkFeeLamports,
        "estimatedNetworkFeeLamports"
      );
      units(chunk.rentQuote.estimatedPriorityFeeLamports, "estimatedPriorityFeeLamports");
      units(chunk.rentQuote.userNonRecoverableLamports, "userNonRecoverableLamports");
      units(chunk.rentQuote.appSponsoredRecoverableLamports, "appSponsoredRecoverableLamports");
      const expectedCleanupShape = [
        ["user_position", "position_terminal_close", "close_user_position", "position"],
        ["strike_market", "strike_terminal_close", "close_strike_market", "strike"],
        ["market_series_and_escrow", "series_terminal_close", "close_market_series", "series"],
      ] as const;
      const rentItems = chunk.rentQuote.recoverableRentItems;
      const sharedCleanup = rentItems.some((item) => item.kind !== "user_position");
      const positionAddresses: string[] = [];
      const invalidRentItem = rentItems.some((item, index) => {
        const expected = sharedCleanup
          ? expectedCleanupShape[index % expectedCleanupShape.length]
          : expectedCleanupShape[0];
        if (
          !expected ||
          item.kind !== expected[0] ||
          item.recoveryCondition !== expected[1] ||
          item.recipient !== owner ||
          !isAddress(item.address) ||
          units(item.amountLamports, "recoverableRentItems.amountLamports") <= 0n
        ) {
          return true;
        }
        if (item.kind === "user_position") positionAddresses.push(item.address);
        return false;
      });
      if (invalidRentItem) {
        throw new StrykeSdkError(
          "intent_mismatch",
          "Cleanup rent recipient or item is not wallet-authoritative"
        );
      }
      const quotedItemTotal = chunk.rentQuote.recoverableRentItems.reduce(
        (sum, item) => sum + units(item.amountLamports, "recoverableRentItems.amountLamports"),
        0n
      );
      const contract = chunk.transaction;
      const invalidInstruction = chunk.instructions.some((instruction, index) => {
        const rentItem = rentItems[index];
        const expected = sharedCleanup
          ? expectedCleanupShape[index % expectedCleanupShape.length]
          : expectedCleanupShape[0];
        return !rentItem || !expected ||
        instruction.name !== expected[2] ||
        instruction.programId !== this.client.capabilities.contract.programId ||
        !instruction.accounts.some((account) =>
          account.name === "rent_recipient" && account.pubkey === owner && account.isWritable
        ) ||
        !instruction.accounts.some((account) =>
          account.name === "processor" && account.pubkey === owner && account.isSigner
        ) ||
        !instruction.accounts.some((account) =>
          account.name === expected[3] &&
          account.pubkey === rentItem.address &&
          account.isWritable
        );
      });
      if (
        recoverable <= 0n ||
        quotedItemTotal !== recoverable ||
        positionAddresses.length === 0 ||
        (sharedCleanup && rentItems.length % expectedCleanupShape.length !== 0) ||
        cleanupItems.some((item) => item === undefined || item.chunkIndex !== chunk.index) ||
        new Set(chunk.itemIds).size !== chunk.itemIds.length ||
        new Set(positionAddresses).size !== positionAddresses.length ||
        chunk.instructions.length !== rentItems.length ||
        contract.feePayer !== owner ||
        contract.signers.length !== 1 ||
        contract.signers[0] !== owner ||
        contract.programId !== this.client.capabilities.contract.programId ||
        contract.contractProfile !== "minimal_pyth" ||
        contract.cluster !== this.client.capabilities.cluster ||
        invalidInstruction
      ) {
        throw new StrykeSdkError(
          "intent_mismatch",
          "Cleanup transaction is not the reviewed wallet-owned close plan"
        );
      }
      const latest = (await this.rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value;
      const reviewed = {
        owner,
        collateral,
        chunk: chunk.index,
        itemIds: chunk.itemIds,
        positionAddresses,
        recoverableLamports: recoverable.toString(),
        estimatedNetworkFeeLamports: networkFee.toString(),
      };
      const hash = await createCleanupIntentHash(reviewed);
      const transactionMessage = appendTransactionMessageInstructions(
        materialize(chunk.instructions),
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash(latest.blockhash),
            lastValidBlockHeight: latest.lastValidBlockHeight,
          },
          setTransactionMessageFeePayer(
            address(owner),
            createTransactionMessage({ version: 0 })
          )
        )
      );
      transactions.push({
        clientActionId: `cleanup-${hash.slice(-24)}`,
        intentHash: hash,
        recentBlockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
        review: {
          cluster: this.client.capabilities.cluster,
          programId: contract.programId,
          owner,
          market: {
            cleanupItems: cleanupItems.map((item) => ({
              id: item!.id,
              market: item!.market,
            })),
          },
          action: "close",
          recoverableLamports: recoverable.toString(),
          estimatedNetworkFeeLamports: networkFee.toString(),
          positionAddresses,
        },
        transactionMessage,
        raw: { transaction: contract },
      });
    }
    return {
      owner,
      totalRecoverableLamports: response.chunks
        .reduce(
          (sum, chunk) =>
            sum + units(chunk.rentQuote.userRecoverableLamports, "userRecoverableLamports"),
          0n
        )
        .toString(),
      totalEstimatedNetworkFeeLamports: response.chunks
        .reduce(
          (sum, chunk) =>
            sum + units(chunk.rentQuote.estimatedNetworkFeeLamports, "estimatedNetworkFeeLamports"),
          0n
        )
        .toString(),
      transactions,
    };
  }
}
