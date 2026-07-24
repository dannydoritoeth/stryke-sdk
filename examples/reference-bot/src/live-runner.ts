import {
  FileActionCheckpointStore,
  MarketsClient,
  PositionsClient,
  QuotesClient,
  ReviewedTransactionExecutor,
  SolanaReviewedExecutionAdapter,
  StrykeSdkError,
  TransactionsClient,
  createPilotIntentHash,
  createTerminalIntentHash,
  terminalActionFor,
  type LatestBlockhashRpc,
  type PilotAsset,
  type PilotExpiryFamily,
  type ExecutableQuote,
  type MaterializedPilotTransaction,
  type PilotMarket,
  type SolanaExecutionRpc,
} from "@stryke/sdk";
import type { TransactionSigner } from "@solana/kit";

import type { StrykeClient } from "@stryke/sdk";

export type LiveBuyInput = {
  client: StrykeClient;
  rpc: SolanaExecutionRpc & LatestBlockhashRpc;
  signer: TransactionSigner;
  checkpointPath: string;
  asset?: PilotAsset;
  expiryFamily?: PilotExpiryFamily;
  side?: "yes" | "no";
  amount?: string;
  maximumSlippageBps?: number;
  clientActionId?: string;
};

type LiveBuyFlow = {
  pending: boolean;
  resume(): Promise<unknown>;
  current(asset: PilotAsset, expiryFamily: PilotExpiryFamily): Promise<PilotMarket>;
  buy(input: {
    market: PilotMarket;
    side: "yes" | "no";
    amount: string;
    maximumSlippageBps: number;
  }): Promise<ExecutableQuote>;
  intent(input: {
    clientActionId: string;
    owner: string;
    market: Record<string, unknown>;
    quote: ExecutableQuote;
  }): Promise<string>;
  prepare(input: {
    owner: string;
    market: PilotMarket;
    quote: ExecutableQuote;
    clientActionId: string;
    intentHash: string;
  }): Promise<MaterializedPilotTransaction>;
  execute(transaction: MaterializedPilotTransaction): Promise<unknown>;
};

export const executeReviewedLiveBuy = async ({
  flow,
  owner,
  asset,
  expiryFamily,
  side,
  amount,
  maximumSlippageBps,
  clientActionId,
}: {
  flow: LiveBuyFlow;
  owner: string;
  asset: PilotAsset;
  expiryFamily: PilotExpiryFamily;
  side: "yes" | "no";
  amount: string;
  maximumSlippageBps: number;
  clientActionId: string;
}) => {
  if (flow.pending) return flow.resume();
  const market = await flow.current(asset, expiryFamily);
  const quote = await flow.buy({ market, side, amount, maximumSlippageBps });
  const marketIdentity = {
    tokenMint: market.tokenMint,
    source: market.source,
    collateral: market.raw.collateral,
    expiryFamily: market.expiryFamily,
    expiryTs: market.expiryTs,
    targetValue: market.strikePrice,
  };
  const intentHash = await flow.intent({
    clientActionId,
    owner,
    market: marketIdentity,
    quote,
  });
  const prepared = await flow.prepare({ owner, market, quote, clientActionId, intentHash });
  return flow.execute(prepared);
};

export const runReviewedLiveBuy = async ({
  client,
  rpc,
  signer,
  checkpointPath,
  asset = "BTC",
  expiryFamily = "five_minute",
  side = "yes",
  amount = "1000000",
  maximumSlippageBps = 100,
  clientActionId = `pilot-${crypto.randomUUID()}`,
}: LiveBuyInput) => {
  const markets = new MarketsClient(client);
  const quotes = new QuotesClient(client);
  const positions = new PositionsClient(client);
  const transactions = new TransactionsClient(client, rpc);
  const checkpoint = new FileActionCheckpointStore(checkpointPath);
  const pending = await checkpoint.load();
  const adapter = new SolanaReviewedExecutionAdapter({
    rpc,
    signer,
    refresh: async ({ clientActionId: actionId }) => ({
      action: await transactions.reconcile(actionId),
      positions: await positions.list(signer.address),
    }),
  });
  const executor = new ReviewedTransactionExecutor(transactions, checkpoint, adapter);
  return executeReviewedLiveBuy({
    flow: {
      pending: pending !== undefined,
      resume: () => executor.resume(),
      current: (selectedAsset, selectedExpiry) => markets.current(selectedAsset, selectedExpiry),
      buy: (input) => quotes.buy(input),
      intent: createPilotIntentHash,
      prepare: (input) => transactions.prepare(input),
      execute: (prepared) => executor.execute(prepared),
    },
    owner: signer.address,
    asset,
    expiryFamily,
    side,
    amount,
    maximumSlippageBps,
    clientActionId,
  });
};

export const runReviewedTerminalAction = async ({
  client,
  rpc,
  signer,
  checkpointPath,
  clientActionId = `pilot-${crypto.randomUUID()}`,
  positionId,
}: Pick<LiveBuyInput, "client" | "rpc" | "signer" | "checkpointPath" | "clientActionId"> & {
  positionId?: string;
}) => {
  const positions = new PositionsClient(client);
  const transactions = new TransactionsClient(client, rpc);
  const checkpoint = new FileActionCheckpointStore(checkpointPath);
  const adapter = new SolanaReviewedExecutionAdapter({
    rpc,
    signer,
    refresh: async ({ clientActionId: actionId }) => ({
      action: await transactions.reconcile(actionId),
      positions: await positions.list(signer.address),
    }),
  });
  const executor = new ReviewedTransactionExecutor(transactions, checkpoint, adapter);
  if (await checkpoint.load()) return executor.resume();

  const position = (await positions.list(signer.address)).find((candidate) => {
    if (positionId && candidate.positionId !== positionId) return false;
    try {
      terminalActionFor(candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (!position) {
    throw new StrykeSdkError("position_state", "No claimable or refundable pilot position was found");
  }
  const action = terminalActionFor(position);
  const intentHash = await createTerminalIntentHash({
    clientActionId,
    owner: signer.address,
    market: position.market as Record<string, unknown>,
    action,
  });
  const prepared = await transactions.prepareTerminal({
    owner: signer.address,
    position,
    action,
    clientActionId,
    intentHash,
  });
  return executor.execute(prepared);
};
