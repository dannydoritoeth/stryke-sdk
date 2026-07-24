import {
  SDK_VERSION,
  SUPPORTED_API_SCHEMA_VERSION,
  SUPPORTED_API_VERSION,
  SUPPORTED_PROGRAM_ID,
  SUPPORTED_PROGRAM_VERSION,
  StrykeSdkError,
  StrykeClient,
  type ExecutableQuote,
} from "@stryke/sdk";
import { createSolanaRpc, isTransactionSigner, type TransactionSigner } from "@solana/kit";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseReferenceBotConfig } from "./config.js";
import { decideEntry } from "./entry.js";
import { emitDecision } from "./logging.js";
import { estimateFairProbability } from "./strategy.js";
import { loadWalletForLiveTrading } from "./wallet.js";
import { runReviewedLiveBuy, runReviewedTerminalAction } from "./live-runner.js";

const compatibility = {
  sdkVersion: SDK_VERSION,
  apiVersion: SUPPORTED_API_VERSION,
  apiSchemaVersion: SUPPORTED_API_SCHEMA_VERSION,
  programId: SUPPORTED_PROGRAM_ID,
  programVersion: SUPPORTED_PROGRAM_VERSION,
};

const sampleQuote: ExecutableQuote = {
  quoteId: "read-only-smoke",
  generatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  marketStateVersion: "documentation-smoke",
  action: "buy",
  side: "yes",
  amount: "10000000",
  fee: "0",
  feeBreakdown: {
    feeMode: "documentation_smoke",
    normalTradingFeeWaivedCollateralUnits: "0",
    grossTradeFeeCollateralUnits: "0",
    normalTradingFeeBps: 0,
    feeBpsApplied: 0,
  },
  expectedShares: "20000000",
  minimumOutput: "19800000",
  maximumSlippageBpsApplied: 100,
  executableProbabilityBps: 4800,
  priceImpactBps: 25,
  raw: {},
};

const envBoolean = (name: string): boolean | undefined => {
  const value = process.env[name];
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new StrykeSdkError("configuration", `${name} must be true or false`);
};

const runReadOnly = () => {
  const input = {
    currentPrice: 100_100,
    strikePrice: 100_000,
    secondsRemaining: 180,
    priceHistory: [
      { price: 100_000, publishTime: Math.floor(Date.now() / 1000) - 1 },
      { price: 100_100, publishTime: Math.floor(Date.now() / 1000) },
    ],
  };
  const config = parseReferenceBotConfig({ killSwitchEnabled: false });
  const decision = decideEntry({
    fairProbability: estimateFairProbability(input),
    quote: sampleQuote,
    config,
    secondsRemaining: input.secondsRemaining,
    tradeSizeLamports: 10_000_000n,
    aggregateExposureLamports: 0n,
    openPositions: 0,
    dataFresh: true,
  });
  emitDecision({
    event: "reference_bot_decision",
    market: { asset: "BTC", expiryFamily: "five_minute", mode: "documentation_smoke" },
    marketState: "open",
    marketStateVersion: sampleQuote.marketStateVersion,
    pyth: { price: input.currentPrice, publishTime: input.priceHistory[0]!.publishTime },
    fairProbability: decision.fairProbability,
    quote: { quoteId: decision.quoteId, executableProbability: decision.quoteProbability },
    decision: { action: decision.action, reason: decision.reason },
    safetyChecks: decision.safetyChecks,
  });
  console.log(JSON.stringify({ event: "stryke_compatibility", ...compatibility }));
};

const runLiveGate = async () => {
  const readOnlyMode = envBoolean("STRYKE_READ_ONLY_MODE");
  const liveTradingEnabled = envBoolean("STRYKE_LIVE_TRADING_ENABLED");
  const killSwitchEnabled = envBoolean("STRYKE_KILL_SWITCH_ENABLED");
  const walletAdapterPath = process.env.STRYKE_WALLET_ADAPTER_PATH;
  const config = parseReferenceBotConfig({
    ...(readOnlyMode === undefined ? {} : { readOnlyMode }),
    ...(liveTradingEnabled === undefined ? {} : { liveTradingEnabled }),
    ...(killSwitchEnabled === undefined ? {} : { killSwitchEnabled }),
    ...(walletAdapterPath === undefined ? {} : { walletAdapterPath }),
  });
  const signer = await loadWalletForLiveTrading<TransactionSigner>(config, async (path) => {
    const module = (await import(
      pathToFileURL(resolve(process.env.INIT_CWD ?? process.cwd(), path)).href
    )) as { default?: unknown };
    if (module.default === undefined) throw new StrykeSdkError("configuration", "Wallet adapter has no default export");
    if (
      typeof module.default !== "object" ||
      module.default === null ||
      !("address" in module.default) ||
      !isTransactionSigner(module.default as { address: never })
    ) {
      throw new StrykeSdkError("configuration", "Wallet adapter must default-export a Solana transaction signer");
    }
    return module.default as TransactionSigner;
  });
  if (!signer) throw new StrykeSdkError("configuration", "Live gates are not all enabled");
  const apiBaseUrl = process.env.STRYKE_API_BASE_URL;
  const rpcUrl = process.env.STRYKE_SOLANA_RPC_URL;
  if (!apiBaseUrl || !rpcUrl) {
    throw new StrykeSdkError("configuration", "Live trading requires API and Solana RPC URLs");
  }
  const client = await StrykeClient.connect({ apiBaseUrl });
  const liveAction = process.env.STRYKE_LIVE_ACTION ?? "buy";
  if (liveAction !== "buy" && liveAction !== "terminal") {
    throw new StrykeSdkError("configuration", "STRYKE_LIVE_ACTION must be buy or terminal");
  }
  const liveInput = {
    client,
    rpc: createSolanaRpc(rpcUrl),
    signer,
    checkpointPath: process.env.STRYKE_CHECKPOINT_PATH ?? ".stryke/reference-bot-action.json",
  };
  const result = liveAction === "buy"
    ? await runReviewedLiveBuy(liveInput)
    : await runReviewedTerminalAction({
        ...liveInput,
        ...(process.env.STRYKE_TERMINAL_POSITION_ID
          ? { positionId: process.env.STRYKE_TERMINAL_POSITION_ID }
          : {}),
      });
  const execution = result as {
    clientActionId?: string;
    signature?: string;
    state?: string;
    refreshed?: { action?: { state?: string }; positions?: unknown[] };
  };
  console.log(JSON.stringify({
    event: "live_action_complete",
    action: liveAction,
    ...compatibility,
    clientActionId: execution.clientActionId,
    signature: execution.signature,
    state: execution.state,
    reconciledState: execution.refreshed?.action?.state,
    positionCount: execution.refreshed?.positions?.length,
  }));
};

try {
  if (process.argv.includes("--live")) await runLiveGate();
  else await runReadOnly();
} catch (error) {
  const failure = error instanceof StrykeSdkError
    ? { code: error.code, message: error.message, retryable: error.retryable }
    : { code: "configuration", message: "Reference bot startup failed", retryable: false };
  console.error(JSON.stringify({ event: "reference_bot_error", ...failure }));
  process.exitCode = 1;
}
