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
    market: Record<string, unknown>;
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

    const transactions: MaterializedCleanupTransaction[] = [];
    for (const chunk of response.chunks) {
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
      const positionAddresses: string[] = chunk.rentQuote.recoverableRentItems.map((item) => {
        if (
          item.kind !== "user_position" ||
          item.recoveryCondition !== "position_terminal_close" ||
          item.recipient !== owner ||
          !isAddress(item.address) ||
          units(item.amountLamports, "recoverableRentItems.amountLamports") <= 0n
        ) {
          throw new StrykeSdkError(
            "intent_mismatch",
            "Cleanup rent recipient or item is not wallet-authoritative"
          );
        }
        return item.address;
      });
      const quotedItemTotal = chunk.rentQuote.recoverableRentItems.reduce(
        (sum, item) => sum + units(item.amountLamports, "recoverableRentItems.amountLamports"),
        0n
      );
      const contract = chunk.transaction;
      const invalidInstruction = chunk.instructions.some((instruction) =>
        instruction.name !== "close_user_position" ||
        instruction.programId !== this.client.capabilities.contract.programId ||
        !instruction.accounts.some((account) =>
          account.name === "rent_recipient" && account.pubkey === owner && account.isWritable
        ) ||
        !instruction.accounts.some((account) =>
          account.name === "processor" && account.pubkey === owner && account.isSigner
        ) ||
        !instruction.accounts.some((account) =>
          account.name === "position" &&
          positionAddresses.includes(account.pubkey) &&
          account.isWritable
        )
      );
      if (
        recoverable <= 0n ||
        quotedItemTotal !== recoverable ||
        positionAddresses.length === 0 ||
        new Set(positionAddresses).size !== positionAddresses.length ||
        chunk.instructions.length !== positionAddresses.length ||
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
          market: { cleanupItemIds: chunk.itemIds },
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
