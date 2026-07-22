import {
  addSignersToInstruction,
  compileTransaction,
  getBase64EncodedWireTransaction,
  getTransactionEncoder,
  signTransactionMessageWithSigners,
  setTransactionMessageFeePayerSigner,
  signature,
  type Instruction,
  type TransactionMessage,
  type TransactionMessageWithFeePayer,
  type TransactionMessageWithSigners,
  type TransactionSigner,
} from "@solana/kit";

import { StrykeSdkError } from "./errors.js";
import type { ConfirmationResult, ReviewedExecutionAdapter } from "./execution.js";
import type { MaterializedPilotTransaction } from "./transactions.js";

type RpcRequest<T> = { send(): Promise<T> };

export interface SolanaExecutionRpc {
  getBlockHeight(config?: { commitment?: "confirmed" }): RpcRequest<bigint>;
  simulateTransaction(
    transaction: string,
    config: { commitment: "confirmed"; encoding: "base64"; sigVerify: false }
  ): RpcRequest<{ value: { err: unknown; logs?: readonly string[] | null } }>;
  sendTransaction(
    transaction: string,
    config: { encoding: "base64"; preflightCommitment: "confirmed"; skipPreflight: true }
  ): RpcRequest<string>;
  getSignatureStatuses(
    signatures: readonly ReturnType<typeof signature>[],
    config?: { searchTransactionHistory?: boolean }
  ): RpcRequest<{
    value: readonly ({
      slot: bigint;
      err: unknown;
      confirmationStatus?: "processed" | "confirmed" | "finalized" | null;
    } | null)[];
  }>;
}

export type SolanaExecutionAdapterOptions = {
  rpc: SolanaExecutionRpc;
  signer: TransactionSigner;
  refresh: ReviewedExecutionAdapter["refresh"];
  confirmationPollIntervalMs?: number;
};

const withSigner = (
  transaction: MaterializedPilotTransaction,
  signer: TransactionSigner
): TransactionMessage & TransactionMessageWithFeePayer & TransactionMessageWithSigners => {
  if (
    transaction.review.owner !== signer.address ||
    transaction.raw.transaction.feePayer !== signer.address
  ) {
    throw new StrykeSdkError(
      "configuration",
      "Wallet signer must match the reviewed owner and prepared fee payer"
    );
  }
  const instructions = transaction.transactionMessage.instructions.map((instruction: Instruction) =>
    addSignersToInstruction([signer], instruction)
  );
  return setTransactionMessageFeePayerSigner(signer, {
    ...transaction.transactionMessage,
    instructions,
  }) as TransactionMessage & TransactionMessageWithFeePayer & TransactionMessageWithSigners;
};

const unsignedWireTransaction = (
  transaction: MaterializedPilotTransaction,
  signer: TransactionSigner
) => getBase64EncodedWireTransaction(compileTransaction(withSigner(transaction, signer)));

export class SolanaReviewedExecutionAdapter implements ReviewedExecutionAdapter {
  private readonly pollIntervalMs: number;

  constructor(private readonly options: SolanaExecutionAdapterOptions) {
    this.pollIntervalMs = options.confirmationPollIntervalMs ?? 500;
  }

  async getBlockHeight(): Promise<bigint> {
    return this.options.rpc.getBlockHeight({ commitment: "confirmed" }).send();
  }

  async simulate(transaction: MaterializedPilotTransaction) {
    const result = await this.options.rpc
      .simulateTransaction(unsignedWireTransaction(transaction, this.options.signer), {
        commitment: "confirmed",
        encoding: "base64",
        sigVerify: false,
      })
      .send();
    return result.value.err === null
      ? ({ ok: true } as const)
      : ({ ok: false, reason: "Solana transaction simulation failed" } as const);
  }

  async sign(transaction: MaterializedPilotTransaction): Promise<Uint8Array> {
    const signed = await signTransactionMessageWithSigners(
      withSigner(transaction, this.options.signer)
    );
    return Uint8Array.from(getTransactionEncoder().encode(signed));
  }

  async submit(signedTransaction: Uint8Array): Promise<string> {
    const encoded = Buffer.from(signedTransaction).toString("base64");
    return this.options.rpc
      .sendTransaction(encoded, {
        encoding: "base64",
        preflightCommitment: "confirmed",
        skipPreflight: true,
      })
      .send();
  }

  async confirm(input: {
    signature: string;
    lastValidBlockHeight: bigint;
  }): Promise<ConfirmationResult> {
    while ((await this.getBlockHeight()) <= input.lastValidBlockHeight) {
      const response = await this.options.rpc
        .getSignatureStatuses([signature(input.signature)], { searchTransactionHistory: true })
        .send();
      const status = response.value[0];
      if (status?.err) return { state: "failed", reason: "Solana transaction failed" };
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
        return { state: "confirmed", observedSlot: Number(status.slot) };
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    return { state: "expired", reason: "Prepared transaction blockhash expired before confirmation" };
  }

  refresh(input: { clientActionId: string; signature: string }): Promise<unknown> {
    return this.options.refresh(input);
  }
}
