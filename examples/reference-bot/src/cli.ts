import {
  FileActionCheckpointStore,
  PositionsClient,
  PriceStore,
  ReviewedTransactionExecutor,
  SDK_VERSION,
  SUPPORTED_API_SCHEMA_VERSION,
  SUPPORTED_API_VERSION,
  SUPPORTED_PROGRAM_ID,
  SUPPORTED_PROGRAM_VERSION,
  SolanaReviewedExecutionAdapter,
  StrykeClient,
  StrykeSdkError,
  TransactionsClient,
  subscribeHermes,
  type ExecutableQuote,
} from "@stryke/sdk";
import { createSolanaRpc, isTransactionSigner, type TransactionSigner } from "@solana/kit";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runReferenceBot } from "./bot.js";
import { parseReferenceBotConfig, parseReferenceBotEnv, publicConfig, type ReferenceBotProfile } from "./config.js";
import { decideEntry } from "./entry.js";
import { emitDecision } from "./logging.js";
import { emitPreflight, requireRootEnvFile, requiredDevnetBalance, runPreflightCheck } from "./preflight.js";
import { createSdkRuntimeAdapter } from "./sdk-runtime.js";
import { estimateFairProbability } from "./strategy.js";
import { loadWalletForLiveTrading } from "./wallet.js";

const compatibility = { sdkVersion: SDK_VERSION, apiVersion: SUPPORTED_API_VERSION, apiSchemaVersion: SUPPORTED_API_SCHEMA_VERSION, programId: SUPPORTED_PROGRAM_ID, programVersion: SUPPORTED_PROGRAM_VERSION };

const sampleQuote: ExecutableQuote = {
  quoteId: "read-only-smoke", generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
  marketStateVersion: "documentation-smoke", action: "buy", side: "yes", amount: "10000000", fee: "0",
  feeBreakdown: { feeMode: "documentation_smoke", normalTradingFeeWaivedCollateralUnits: "0", grossTradeFeeCollateralUnits: "0", normalTradingFeeBps: 0, feeBpsApplied: 0 },
  expectedShares: "20000000", minimumOutput: "19800000", maximumSlippageBpsApplied: 100,
  executableProbabilityBps: 4800, priceImpactBps: 25, raw: {},
};

const runFixtureSmoke = () => {
  const now = Math.floor(Date.now() / 1_000);
  const input = { currentPrice: 100_100, strikePrice: 100_000, secondsRemaining: 180, priceHistory: [{ price: 100_000, publishTime: now - 1 }, { price: 100_100, publishTime: now }] };
  const config = parseReferenceBotConfig({ killSwitchEnabled: false });
  const decision = decideEntry({ fairProbability: estimateFairProbability(input, config.estimator), quote: sampleQuote, config, secondsRemaining: input.secondsRemaining, tradeSizeLamports: config.tradeSizeLamports, aggregateExposureLamports: 0n, openPositions: 0, dataFresh: true });
  emitDecision({ event: "reference_bot_decision", market: { asset: config.asset, expiryFamily: config.expiryFamily, mode: "documentation_smoke" }, marketState: "open", marketStateVersion: sampleQuote.marketStateVersion, pyth: { price: input.currentPrice, publishTime: now }, fairProbability: decision.fairProbability, quote: { quoteId: decision.quoteId, executableProbability: decision.quoteProbability }, decision: { action: decision.action, reason: decision.reason }, safetyChecks: decision.safetyChecks });
  console.log(JSON.stringify({ event: "stryke_compatibility", ...compatibility }));
};

const loadSigner = async (config: ReturnType<typeof parseReferenceBotEnv>) => loadWalletForLiveTrading<TransactionSigner>(config, async (path) => {
  let module: { default?: unknown };
  try {
    module = (await import(pathToFileURL(resolve(process.env.INIT_CWD ?? process.cwd(), path)).href)) as { default?: unknown };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "adapter import failed";
    throw new StrykeSdkError("configuration", `Cannot load STRYKE_WALLET_ADAPTER_PATH: ${detail}`);
  }
  if (!module.default || typeof module.default !== "object" || !("address" in module.default) || !isTransactionSigner(module.default as { address: never })) {
    throw new StrykeSdkError("configuration", "Wallet adapter must default-export a Solana transaction signer");
  }
  return module.default as TransactionSigner;
});

const waitForPriceHistory = async (store: PriceStore, asset: "BTC" | "SOL", timeoutMs = 30_000) => {
  const started = Date.now();
  while (store.history(asset).length < 2) {
    if (Date.now() - started >= timeoutMs) throw new StrykeSdkError("source_unavailable", "Pyth did not provide two fresh ordered prices within 30 seconds", true);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

const selectedProfile = (): ReferenceBotProfile => {
  const value = process.argv.find((argument) => argument.startsWith("--profile="))?.split("=", 2)[1];
  if (value === "paper" || value === "devnet" || value === "live") return value;
  throw new StrykeSdkError("configuration", "Use --profile=paper, --profile=devnet, or --profile=live");
};

const selectedMaximumTicks = (): number | undefined => {
  const raw = process.argv.find((argument) => argument.startsWith("--ticks="))?.split("=", 2)[1];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 2) throw new StrykeSdkError("configuration", "--ticks must be an integer of at least 2");
  return value;
};

const runSdkBot = async (profile: ReferenceBotProfile) => {
  if (profile !== "live") requireRootEnvFile(profile);
  let config: ReturnType<typeof parseReferenceBotEnv>;
  try {
    config = parseReferenceBotEnv(process.env, profile);
  } catch (error) {
    if (profile !== "live") {
      emitPreflight(profile, "environment", "failed", error instanceof Error ? error.message : "Invalid .env configuration", "Compare .env with .env.example, correct the named value, and retry.");
    }
    throw error;
  }
  if (!config.apiBaseUrl) throw new StrykeSdkError("configuration", "STRYKE_API_BASE_URL is required for live-data mode");
  console.log(JSON.stringify({ event: "reference_bot_config", config: publicConfig(config), ...compatibility }));
  const client = await runPreflightCheck(
    profile,
    "api",
    "Connected to a compatible Stryke API.",
    "Check STRYKE_API_BASE_URL and confirm the invited devnet API is healthy and compatible.",
    () => StrykeClient.connect({ apiBaseUrl: config.apiBaseUrl! })
  );
  const priceStore = new PriceStore({ maximumHistoryPoints: config.priceHistoryMaxPoints });
  const pythEndpoint = process.env.STRYKE_PYTH_HERMES_URL ?? "https://hermes.pyth.network";
  const pythRemediation = "Check STRYKE_PYTH_HERMES_URL and network access, then retry; do not substitute another price source.";
  const subscription = await runPreflightCheck(
    profile,
    "pyth",
    `Connected to Pyth for ${config.asset}.`,
    pythRemediation,
    () => subscribeHermes({ endpoint: pythEndpoint, assets: [config.asset], store: priceStore })
  );
  try {
    emitPreflight(profile, "pyth", "checking", `Waiting for two fresh ordered ${config.asset} Pyth prices.`);
    try {
      await waitForPriceHistory(priceStore, config.asset);
      emitPreflight(profile, "pyth", "passed", `Received two fresh ordered ${config.asset} Pyth prices.`);
    } catch (error) {
      emitPreflight(profile, "pyth", "failed", error instanceof Error ? error.message : "Pyth startup failed", pythRemediation);
      throw error;
    }
    const signer = profile === "devnet"
      ? await runPreflightCheck(profile, "wallet", "Loaded the configured devnet wallet adapter.", "Check STRYKE_WALLET_ADAPTER_PATH and STRYKE_WALLET_KEYPAIR_PATH; follow docs/quickstart.md to create the keypair.", () => loadSigner(config))
      : undefined;
    const rpc = createSolanaRpc(config.solanaRpcUrl ?? "http://127.0.0.1:8899");
    if (profile === "paper") {
      emitPreflight(profile, "wallet", "skipped", "Paper mode never loads a wallet.");
      emitPreflight(profile, "rpc", "skipped", "Paper mode makes no wallet RPC checks.");
      emitPreflight(profile, "funding", "skipped", "Paper mode requires no wallet funding.");
    } else if (signer) {
      const balance = await runPreflightCheck(
        profile,
        "rpc",
        `Connected to devnet RPC for wallet ${signer.address}.`,
        "Check STRYKE_SOLANA_RPC_URL and confirm the endpoint is reachable and set to devnet.",
        async () => (await rpc.getBalance(signer.address, { commitment: "confirmed" }).send()).value
      );
      const minimumBalance = requiredDevnetBalance(config.maximumTradeSizeLamports);
      if (balance < minimumBalance) {
        const remediation = `Run \`solana airdrop 2 ${signer.address} --url devnet\`, then retry.`;
        emitPreflight(profile, "funding", "failed", `Wallet ${signer.address} has ${balance} lamports; at least ${minimumBalance} are required.`, remediation);
        throw new StrykeSdkError("configuration", remediation);
      }
      emitPreflight(profile, "funding", "passed", `Wallet ${signer.address} has enough devnet SOL for the configured trade cap and execution buffer.`);
    }
    const checkpoint = new FileActionCheckpointStore(
      resolve(process.env.INIT_CWD ?? process.cwd(), config.checkpointPath)
    );
    let executor: ReviewedTransactionExecutor | undefined;
    if (signer) {
      const transactions = new TransactionsClient(client, rpc);
      const positions = new PositionsClient(client);
      const executionAdapter = new SolanaReviewedExecutionAdapter({ rpc, signer, refresh: async ({ clientActionId }) => ({ action: await transactions.reconcile(clientActionId), positions: await positions.list(signer.address) }) });
      executor = new ReviewedTransactionExecutor(transactions, checkpoint, executionAdapter);
    }
    const adapter = createSdkRuntimeAdapter({ client, rpc, priceStore, checkpoint, config, ...(signer ? { owner: signer.address } : {}), ...(executor ? { executor } : {}) });
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    process.once("SIGTERM", () => controller.abort());
    const maximumTicks = selectedMaximumTicks();
    await runReferenceBot({ config, adapter, once: process.argv.includes("--once"), ...(maximumTicks === undefined ? {} : { maximumTicks }), signal: controller.signal });
  } finally { subscription.close(); }
};

try {
  if (process.argv.some((argument) => argument.startsWith("--profile="))) await runSdkBot(selectedProfile());
  else if (process.argv.includes("--live") || process.argv.includes("--live-data")) await runSdkBot(process.argv.includes("--live") ? "devnet" : "paper");
  else runFixtureSmoke();
} catch (error) {
  const failure = error instanceof StrykeSdkError ? { code: error.code, message: error.message, retryable: error.retryable } : { code: "configuration", message: error instanceof Error ? error.message : "Reference bot startup failed", retryable: false };
  console.error(JSON.stringify({ event: "reference_bot_error", ...failure }));
  process.exitCode = 1;
}
