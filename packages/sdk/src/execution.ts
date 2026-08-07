import type { ActionCheckpointStore } from "./checkpoints.js";
import { StrykeSdkError } from "./errors.js";
import type {
  MaterializedPilotTransaction,
  PilotActionReconciliation,
  TransactionsClient,
} from "./transactions.js";

export type ConfirmationResult =
  | { state: "confirmed"; observedSlot?: number }
  | { state: "failed"; reason: string }
  | { state: "expired"; reason: string }
  | { state: "unknown"; reason: string };

export interface ReviewedExecutionAdapter {
  getBlockHeight(): Promise<bigint>;
  simulate(transaction: MaterializedPilotTransaction): Promise<
    | { ok: true }
    | { ok: false; reason: string }
  >;
  sign(transaction: MaterializedPilotTransaction): Promise<Uint8Array>;
  submit(signedTransaction: Uint8Array): Promise<string>;
  confirm(input: {
    signature: string;
    lastValidBlockHeight: bigint;
  }): Promise<ConfirmationResult>;
  refresh(input: {
    clientActionId: string;
    signature: string;
  }): Promise<unknown>;
}

export type ReviewedExecutionResult = {
  clientActionId: string;
  intentHash: string;
  signature?: string;
  state: "confirmed" | "failed" | "expired" | "unknown";
  refreshed?: unknown;
};

const requireLiveBlockhash = async (
  adapter: ReviewedExecutionAdapter,
  transaction: MaterializedPilotTransaction
) => {
  if ((await adapter.getBlockHeight()) > transaction.lastValidBlockHeight) {
    throw new StrykeSdkError("blockhash_expired", "Prepared transaction blockhash expired");
  }
};

const refreshConfirmed = async (
  adapter: ReviewedExecutionAdapter,
  input: { clientActionId: string; signature: string }
): Promise<unknown> => {
  const maximumAttempts = 10;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await adapter.refresh(input);
    } catch (error) {
      if (
        !(error instanceof StrykeSdkError) ||
        !error.retryable ||
        attempt === maximumAttempts
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new StrykeSdkError("source_stale", "Confirmed action refresh did not converge", true);
};

export class ReviewedTransactionExecutor {
  constructor(
    private readonly transactions: TransactionsClient,
    private readonly checkpoint: ActionCheckpointStore,
    private readonly adapter: ReviewedExecutionAdapter
  ) {}

  async resume(): Promise<PilotActionReconciliation | undefined> {
    const pending = await this.checkpoint.load();
    if (!pending) return undefined;
    const reconciled = await this.transactions.reconcile(pending.clientActionId);
    if (reconciled.intentHash !== pending.intentHash) {
      throw new StrykeSdkError("intent_mismatch", "Checkpoint intent does not match API action");
    }
    if (reconciled.state === "confirmed") {
      if (reconciled.signature) {
        await refreshConfirmed(this.adapter, {
          clientActionId: pending.clientActionId,
          signature: reconciled.signature,
        });
      }
      await this.checkpoint.clear(pending.clientActionId);
      return reconciled;
    }
    if (reconciled.state === "failed" || reconciled.state === "expired") {
      await this.checkpoint.clear(pending.clientActionId);
      return reconciled;
    }
    if (reconciled.state === "submitted" || reconciled.state === "unknown") {
      await this.checkpoint.save({
        clientActionId: pending.clientActionId,
        intentHash: pending.intentHash,
        state: reconciled.state,
        ...(reconciled.signature ? { signature: reconciled.signature } : {}),
      });
      throw new StrykeSdkError(
        "duplicate_action",
        "Submitted or unknown action must reconcile before retry",
        true,
        { clientActionId: pending.clientActionId }
      );
    }
    if (pending.state === "unknown") {
      throw new StrykeSdkError(
        "duplicate_action",
        "Locally unknown submission cannot be retried without authoritative evidence",
        false,
        { clientActionId: pending.clientActionId }
      );
    }
    return reconciled;
  }

  async execute(
    transaction: MaterializedPilotTransaction
  ): Promise<ReviewedExecutionResult> {
    const pending = await this.checkpoint.load();
    if (pending && pending.clientActionId !== transaction.clientActionId) {
      await this.resume();
      throw new StrykeSdkError("duplicate_action", "Another action is pending");
    }
    await this.checkpoint.save({
      clientActionId: transaction.clientActionId,
      intentHash: transaction.intentHash,
      state: "not_submitted",
    });
    await requireLiveBlockhash(this.adapter, transaction);
    const simulation = await this.adapter.simulate(transaction);
    if (!simulation.ok) {
      await this.checkpoint.clear(transaction.clientActionId);
      throw new StrykeSdkError("simulation_failed", simulation.reason);
    }
    let signed: Uint8Array;
    try {
      signed = await this.adapter.sign(transaction);
    } catch {
      await this.checkpoint.clear(transaction.clientActionId);
      throw new StrykeSdkError("wallet_rejected", "Wallet rejected transaction signing");
    }
    await requireLiveBlockhash(this.adapter, transaction);
    let signature: string;
    try {
      signature = await this.adapter.submit(signed);
    } catch {
      await this.checkpoint.save({
        clientActionId: transaction.clientActionId,
        intentHash: transaction.intentHash,
        state: "unknown",
      });
      throw new StrykeSdkError(
        "submission_failed",
        "Signed transaction submission outcome is unknown"
      );
    }
    await this.checkpoint.save({
      clientActionId: transaction.clientActionId,
      intentHash: transaction.intentHash,
      signature,
      state: "submitted",
    });
    try {
      await this.transactions.registerSubmission({
        clientActionId: transaction.clientActionId,
        intentHash: transaction.intentHash,
        signature,
      });
    } catch {
      throw new StrykeSdkError(
        "confirmation_unknown",
        "Signature was received but action registration is unavailable",
        true,
        { clientActionId: transaction.clientActionId }
      );
    }
    let confirmation: ConfirmationResult;
    try {
      confirmation = await this.adapter.confirm({
        signature,
        lastValidBlockHeight: transaction.lastValidBlockHeight,
      });
    } catch {
      await this.checkpoint.save({
        clientActionId: transaction.clientActionId,
        intentHash: transaction.intentHash,
        signature,
        state: "unknown",
      });
      throw new StrykeSdkError(
        "confirmation_timeout",
        "Transaction confirmation timed out",
        true,
        { clientActionId: transaction.clientActionId }
      );
    }
    if (confirmation.state === "confirmed") {
      const refreshed = await refreshConfirmed(this.adapter, {
        clientActionId: transaction.clientActionId,
        signature,
      });
      await this.checkpoint.clear(transaction.clientActionId);
      return {
        clientActionId: transaction.clientActionId,
        intentHash: transaction.intentHash,
        signature,
        state: "confirmed",
        refreshed,
      };
    }
    if (confirmation.state === "failed" || confirmation.state === "expired") {
      await this.checkpoint.clear(transaction.clientActionId);
      return {
        clientActionId: transaction.clientActionId,
        intentHash: transaction.intentHash,
        signature,
        state: confirmation.state,
      };
    }
    await this.checkpoint.save({
      clientActionId: transaction.clientActionId,
      intentHash: transaction.intentHash,
      signature,
      state: "unknown",
    });
    return {
      clientActionId: transaction.clientActionId,
      intentHash: transaction.intentHash,
      signature,
      state: "unknown",
    };
  }
}
