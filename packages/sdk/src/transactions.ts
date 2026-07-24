import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  createTransactionMessage,
  getBase64Encoder,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
} from "@solana/kit";

import type { StrykeClient } from "./client.js";
import { StrykeSdkError } from "./errors.js";
import type { ExecutableQuote } from "./quotes.js";
import type { PilotMarket } from "./markets.js";
import { terminalActionFor, type PilotPosition, type PositionTerminalAction } from "./positions.js";

export type LatestBlockhash = {
  blockhash: string;
  lastValidBlockHeight: bigint;
};

export type LatestBlockhashRpc = {
  getLatestBlockhash(config?: { commitment?: "confirmed" }): {
    send(): Promise<{ value: LatestBlockhash }>;
  };
};

type PrepInstruction = {
  name: string;
  programId?: string;
  dataBase64?: string;
  accounts: Array<{
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }>;
};

type PrepResponse = {
  clientActionId: string;
  intentHash: string;
  quoteBinding?: {
    quoteId: string;
    generatedAt: string;
    expiresAt: string;
    marketStateVersion: string;
    minimumOutput: string;
    maximumSlippageBpsApplied: number;
  };
  owner: string;
  market: Record<string, unknown>;
  action: "buy" | "sell" | "claim" | "refund";
  side?: "yes" | "no";
  instructions: PrepInstruction[];
  transaction: {
    kind: "instruction_plan";
    feePayer: string;
    recentBlockhashRequired: true;
    signers: string[];
    programId: string;
    contractProfile: "minimal_pyth";
    cluster?: "devnet";
  };
  metadata?: { environment?: { solanaCluster?: string } };
};

const accountRole = (account: PrepInstruction["accounts"][number]): AccountRole =>
  account.isSigner
    ? account.isWritable
      ? AccountRole.WRITABLE_SIGNER
      : AccountRole.READONLY_SIGNER
    : account.isWritable
    ? AccountRole.WRITABLE
    : AccountRole.READONLY;

const materializeInstructions = (instructions: readonly PrepInstruction[]): Instruction[] =>
  instructions.map((instruction) => {
    if (!instruction.programId || !instruction.dataBase64) {
      throw new StrykeSdkError(
        "validation",
        `Prepared instruction ${instruction.name} is not materializable`
      );
    }
    return {
      programAddress: address(instruction.programId),
      accounts: instruction.accounts.map((account) => ({
        address: address(account.pubkey),
        role: accountRole(account),
      })),
      data: getBase64Encoder().encode(instruction.dataBase64),
    };
  });

export type MaterializedPilotTransaction = {
  clientActionId: string;
  intentHash: string;
  quoteId?: string;
  marketStateVersion?: string;
  minimumOutput?: string;
  recentBlockhash: string;
  lastValidBlockHeight: bigint;
  review: {
    cluster: "devnet";
    programId: string;
    owner: string;
    market: Record<string, unknown>;
    action: "buy" | "sell" | "claim" | "refund";
    side?: "yes" | "no";
    amount?: string;
  };
  transactionMessage: ReturnType<typeof appendTransactionMessageInstructions>;
  raw: Readonly<PrepResponse>;
};

export type PilotActionState =
  | "not_submitted"
  | "submitted"
  | "confirmed"
  | "failed"
  | "expired"
  | "unknown";

export type PilotActionReconciliation = {
  apiVersion: "v1";
  schemaVersion: "stryke.pilotAction.v1";
  clientActionId: string;
  intentHash: string;
  state: PilotActionState;
  rawReason: string;
  signature?: string;
  observedSlot?: number;
  observedAt: string;
  raw: Readonly<Record<string, unknown>>;
};

const hashIntent = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `intent_v1_${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
};

export const createPilotIntentHash = async ({
  clientActionId,
  owner,
  market,
  quote,
}: {
  clientActionId: string;
  owner: string;
  market: Record<string, unknown>;
  quote: ExecutableQuote;
}): Promise<string> =>
  hashIntent({
    apiVersion: "v1",
    clientActionId,
    owner,
    market,
    action: quote.action,
    side: quote.side,
    amount: quote.amount,
    quoteBinding: {
      quoteId: quote.quoteId,
      generatedAt: quote.generatedAt,
      expiresAt: quote.expiresAt,
      marketStateVersion: quote.marketStateVersion,
      minimumOutput: quote.minimumOutput,
      maximumSlippageBpsApplied: quote.maximumSlippageBpsApplied,
    },
  });

export const createTerminalIntentHash = async ({
  clientActionId,
  owner,
  market,
  action,
}: {
  clientActionId: string;
  owner: string;
  market: Record<string, unknown>;
  action: PositionTerminalAction;
}): Promise<string> =>
  hashIntent({
    apiVersion: "v1",
    clientActionId,
    owner,
    market,
    action,
  });

const parsePilotAction = (
  value: unknown,
  expected: { clientActionId: string; intentHash?: string }
): PilotActionReconciliation => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StrykeSdkError("validation", "Invalid pilot action response");
  }
  const row = value as Record<string, unknown>;
  const states = ["not_submitted", "submitted", "confirmed", "failed", "expired", "unknown"];
  if (
    row.apiVersion !== "v1" ||
    row.schemaVersion !== "stryke.pilotAction.v1" ||
    row.clientActionId !== expected.clientActionId ||
    (expected.intentHash !== undefined && row.intentHash !== expected.intentHash) ||
    typeof row.intentHash !== "string" ||
    !states.includes(String(row.state)) ||
    typeof row.rawReason !== "string" ||
    typeof row.observedAt !== "string"
  ) {
    throw new StrykeSdkError("compatibility", "Pilot action reconciliation contract changed");
  }
  return {
    apiVersion: "v1",
    schemaVersion: "stryke.pilotAction.v1",
    clientActionId: expected.clientActionId,
    intentHash: row.intentHash,
    state: row.state as PilotActionState,
    rawReason: row.rawReason,
    ...(typeof row.signature === "string" ? { signature: row.signature } : {}),
    ...(typeof row.observedSlot === "number" ? { observedSlot: row.observedSlot } : {}),
    observedAt: row.observedAt,
    raw: row,
  };
};

export class TransactionsClient {
  constructor(
    private readonly client: StrykeClient,
    private readonly rpc: LatestBlockhashRpc,
    private readonly now: () => number = Date.now
  ) {}

  async prepare({
    owner,
    market,
    quote,
    clientActionId,
    intentHash,
  }: {
    owner: string;
    market: PilotMarket;
    quote: ExecutableQuote;
    clientActionId: string;
    intentHash: string;
  }): Promise<MaterializedPilotTransaction> {
    if (this.now() >= Date.parse(quote.expiresAt)) {
      throw new StrykeSdkError("quote_blocked", "Executable quote has expired");
    }
    const collateral = market.raw.collateral;
    const marketIdentity = {
      tokenMint: market.tokenMint,
      source: market.source,
      collateral,
      expiryFamily: market.expiryFamily,
      expiryTs: market.expiryTs,
      targetValue: market.strikePrice,
    };
    const expectedIntentHash = await createPilotIntentHash({
      clientActionId,
      owner,
      market: marketIdentity,
      quote,
    });
    if (intentHash !== expectedIntentHash) {
      throw new StrykeSdkError("intent_mismatch", "Local transaction intent hash is invalid");
    }
    const response = await this.client.requestJson<PrepResponse>(
      "/v1/pilot/transaction-prep",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner,
          market: marketIdentity,
          action: quote.action,
          side: quote.side,
          amount: quote.amount,
          maxSlippageBps: quote.maximumSlippageBpsApplied,
          clientActionId,
          intentHash,
          quoteBinding: {
            quoteId: quote.quoteId,
            generatedAt: quote.generatedAt,
            expiresAt: quote.expiresAt,
            marketStateVersion: quote.marketStateVersion,
            minimumOutput: quote.minimumOutput,
            maximumSlippageBpsApplied: quote.maximumSlippageBpsApplied,
          },
        }),
      }
    );
    const mismatches = [
      ["clientActionId", response.clientActionId === clientActionId],
      ["intentHash", response.intentHash === intentHash],
      ["owner", response.owner === owner],
      ["action", response.action === quote.action],
      ["side", response.side === quote.side],
      ["quoteId", response.quoteBinding?.quoteId === quote.quoteId],
      ["marketStateVersion", response.quoteBinding?.marketStateVersion === quote.marketStateVersion],
      ["minimumOutput", response.quoteBinding?.minimumOutput === quote.minimumOutput],
      ["tokenMint", response.market.tokenMint === market.raw.tokenMint],
      ["source", response.market.source === marketIdentity.source],
      ["expiryFamily", response.market.expiryFamily === marketIdentity.expiryFamily],
      ["expiryTs", response.market.expiryTs === marketIdentity.expiryTs],
      ["targetValue", response.market.targetValue === marketIdentity.targetValue],
      ["collateral", JSON.stringify(response.market.collateral) === JSON.stringify(marketIdentity.collateral)],
      ["cluster", response.metadata?.environment?.solanaCluster === "devnet"],
      ["contractProfile", response.transaction.contractProfile === "minimal_pyth"],
      ["programId", response.transaction.programId === this.client.capabilities.contract.programId],
    ].filter(([, matches]) => !matches).map(([field]) => field);
    if (mismatches.length > 0) {
      throw new StrykeSdkError(
        "intent_mismatch",
        `Prepared transaction intent does not match reviewed fields: ${mismatches.join(", ")}`
      );
    }
    const latest = await this.rpc
      .getLatestBlockhash({ commitment: "confirmed" })
      .send();
    const lifetime = latest.value;
    const instructions = materializeInstructions(response.instructions);
    const transactionMessage = appendTransactionMessageInstructions(
      instructions,
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash(lifetime.blockhash),
          lastValidBlockHeight: lifetime.lastValidBlockHeight,
        },
        setTransactionMessageFeePayer(
          address(response.transaction.feePayer),
          createTransactionMessage({ version: 0 })
        )
      )
    );
    return {
      clientActionId,
      intentHash,
      quoteId: quote.quoteId,
      marketStateVersion: quote.marketStateVersion,
      minimumOutput: quote.minimumOutput,
      recentBlockhash: lifetime.blockhash,
      lastValidBlockHeight: lifetime.lastValidBlockHeight,
      review: {
        cluster: "devnet",
        programId: response.transaction.programId,
        owner,
        market: response.market,
        action: quote.action,
        side: quote.side,
        amount: quote.amount,
      },
      transactionMessage,
      raw: response,
    };
  }

  async prepareTerminal({
    owner,
    position,
    action,
    clientActionId,
    intentHash,
  }: {
    owner: string;
    position: PilotPosition;
    action: PositionTerminalAction;
    clientActionId: string;
    intentHash: string;
  }): Promise<MaterializedPilotTransaction> {
    if (position.owner !== owner || terminalActionFor(position, this.now()) !== action) {
      throw new StrykeSdkError("position_state", "Terminal position action is unavailable");
    }
    const market = position.market as Record<string, unknown>;
    const expectedIntentHash = await createTerminalIntentHash({
      clientActionId,
      owner,
      market,
      action,
    });
    if (intentHash !== expectedIntentHash) {
      throw new StrykeSdkError("intent_mismatch", "Local terminal intent hash is invalid");
    }
    const response = await this.client.requestJson<PrepResponse>(
      "/v1/pilot/transaction-prep",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner, market, action, clientActionId, intentHash }),
      }
    );
    if (
      response.clientActionId !== clientActionId ||
      response.intentHash !== intentHash ||
      response.owner !== owner ||
      response.action !== action ||
      response.side !== undefined ||
      response.quoteBinding !== undefined ||
      JSON.stringify({
        tokenMint: response.market.tokenMint,
        source: response.market.source,
        collateral: response.market.collateral,
        expiryFamily: response.market.expiryFamily,
        expiryTs: response.market.expiryTs,
        targetValue: response.market.targetValue,
      }) !== JSON.stringify(market) ||
      response.metadata?.environment?.solanaCluster !== "devnet" ||
      response.transaction.contractProfile !== "minimal_pyth" ||
      response.transaction.programId !== this.client.capabilities.contract.programId
    ) {
      throw new StrykeSdkError("intent_mismatch", "Prepared terminal intent does not match review");
    }
    const latest = await this.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const transactionMessage = appendTransactionMessageInstructions(
      materializeInstructions(response.instructions),
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash(latest.value.blockhash),
          lastValidBlockHeight: latest.value.lastValidBlockHeight,
        },
        setTransactionMessageFeePayer(
          address(response.transaction.feePayer),
          createTransactionMessage({ version: 0 })
        )
      )
    );
    return {
      clientActionId,
      intentHash,
      recentBlockhash: latest.value.blockhash,
      lastValidBlockHeight: latest.value.lastValidBlockHeight,
      review: { cluster: "devnet", programId: response.transaction.programId, owner, market, action },
      transactionMessage,
      raw: response,
    };
  }

  async registerSubmission(input: {
    clientActionId: string;
    intentHash: string;
    signature: string;
  }): Promise<PilotActionReconciliation> {
    const response = await this.client.requestJson<unknown>(
      `/v1/pilot/actions/${encodeURIComponent(input.clientActionId)}/submission`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intentHash: input.intentHash,
          signature: input.signature,
        }),
      }
    );
    return parsePilotAction(response, input);
  }

  async reconcile(clientActionId: string): Promise<PilotActionReconciliation> {
    const response = await this.client.requestJson<unknown>(
      `/v1/pilot/actions/${encodeURIComponent(clientActionId)}`
    );
    return parsePilotAction(response, { clientActionId });
  }
}
