import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createSolanaRpc, isTransactionSigner } from "@solana/kit";
import {
  FileActionCheckpointStore, PriceStore, ReviewedTransactionExecutor,
  SolanaReviewedExecutionAdapter, StrykeClient, TransactionsClient, subscribeHermes,
} from "@stryke/sdk";
import { parseReferenceBotConfig } from "../examples/reference-bot/dist/config.js";
import { createSdkRuntimeAdapter } from "../examples/reference-bot/dist/sdk-runtime.js";

if (!process.argv.includes("--i-approve-devnet-liquidity")) throw new Error("Pass --i-approve-devnet-liquidity to submit fixture trades");
for (const name of ["STRYKE_API_BASE_URL", "STRYKE_SOLANA_RPC_URL", "STRYKE_LIQUIDITY_KEYPAIR_PATH"]) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
const genesisResponse = await fetch(process.env.STRYKE_SOLANA_RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash" }) });
const genesis = await genesisResponse.json();
if (genesis.result !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("Liquidity fixture is devnet-only");
const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const asset = option("asset", "BTC");
const expiryFamily = option("expiry", "five_minute");
const amount = BigInt(option("amount-lamports", "1000000"));
const requireFreshRound = process.argv.includes("--fresh-round");
if (!["BTC", "SOL"].includes(asset)) throw new Error("--asset must be BTC or SOL");
if (!["five_minute", "fifteen_minute", "hourly"].includes(expiryFamily)) throw new Error("--expiry is invalid");
if (amount < 1n || amount > 1_000_000n) throw new Error("--amount-lamports must be 1..1000000");

process.env.STRYKE_WALLET_KEYPAIR_PATH = process.env.STRYKE_LIQUIDITY_KEYPAIR_PATH;
const walletModule = await import(pathToFileURL(resolve("examples/reference-bot/wallet-adapter.example.mjs")).href + `?fixture=${Date.now()}`);
const signer = walletModule.default;
if (!isTransactionSigner(signer)) throw new Error("Fixture keypair did not produce a transaction signer");
const client = await StrykeClient.connect({ apiBaseUrl: process.env.STRYKE_API_BASE_URL });
const rpc = createSolanaRpc(process.env.STRYKE_SOLANA_RPC_URL);
const store = new PriceStore();
const subscription = await subscribeHermes({ endpoint: process.env.STRYKE_PYTH_HERMES_URL ?? "https://hermes.pyth.network", assets: [asset], store });
try {
  const deadline = Date.now() + 30_000;
  while (store.history(asset).length < 2) {
    if (Date.now() >= deadline) throw new Error("Pyth price startup timed out");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  const config = parseReferenceBotConfig({ asset, expiryFamily, strategy: "baseline", estimator: "distance_to_strike", tradeSizeLamports: amount, maximumTradeSizeLamports: amount, maximumAggregateExposureLamports: amount * 10n, maximumPriceImpactBps: 5_000, feeFreeActivationLimitLamports: 10_000_000_000n, feeFreeBufferLamports: 0n, readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: false });
  const checkpoint = new FileActionCheckpointStore(resolve(`artifacts/devnet-bot-matrix/liquidity-${asset.toLowerCase()}-${expiryFamily}.json`));
  const transactions = new TransactionsClient(client, rpc);
  const executionAdapter = new SolanaReviewedExecutionAdapter({ rpc, signer, refresh: async ({ clientActionId }) => ({ action: await transactions.reconcile(clientActionId) }) });
  const executor = new ReviewedTransactionExecutor(transactions, checkpoint, executionAdapter);
  const runtime = createSdkRuntimeAdapter({ client, rpc, priceStore: store, checkpoint, config, owner: signer.address, executor });
  await executor.resume();
  const evaluateWithMaterializationRetry = async () => {
    const deadline = Date.now() + 30_000;
    for (;;) {
      try { return await runtime.evaluateEntry(); }
      catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
      }
    }
  };
  const signatures = [];
  let selectedEvaluation = await evaluateWithMaterializationRetry();
  if (requireFreshRound && Math.floor(Date.now() / 1_000) - selectedEvaluation.market.intervalStartTs > 15) {
    const expiringMarketId = selectedEvaluation.market.marketId;
    const waitMs = Math.max(1_000, (selectedEvaluation.market.expiryTs - Math.floor(Date.now() / 1_000) + 2) * 1_000);
    console.log(JSON.stringify({ event: "devnet_liquidity_waiting_for_fresh_round", asset, expiryFamily, waitMs }));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, waitMs));
    const freshDeadline = Date.now() + 45_000;
    for (;;) {
      selectedEvaluation = await evaluateWithMaterializationRetry();
      const ageSeconds = Math.floor(Date.now() / 1_000) - selectedEvaluation.market.intervalStartTs;
      if (selectedEvaluation.market.marketId !== expiringMarketId && ageSeconds <= 20) break;
      if (Date.now() >= freshDeadline) throw new Error("Fresh market did not materialize before the liquidity deadline");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    }
  }
  const selectedMarketId = selectedEvaluation.market.marketId;
  for (const side of ["yes", "no"]) {
    const evaluation = side === "yes" ? selectedEvaluation : await evaluateWithMaterializationRetry();
    if (evaluation.market.marketId !== selectedMarketId) throw new Error("Market rolled while seeding opposing liquidity; retry the cell");
    const quote = evaluation.buyQuotes.find((candidate) => candidate.side === side);
    if (!quote) throw new Error(`Missing ${side} quote`);
    const result = await runtime.executeBuy(evaluation, quote);
    signatures.push({ side, marketId: evaluation.market.marketId, signature: result.signature, clientActionId: result.clientActionId });
    await checkpoint.clear(result.clientActionId);
  }
  console.log(JSON.stringify({ event: "devnet_opposing_liquidity_seeded", owner: signer.address, asset, expiryFamily, amountLamports: amount.toString(), freshRound: requireFreshRound, signatures }));
} finally {
  subscription.close();
}
