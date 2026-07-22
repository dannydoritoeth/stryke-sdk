import {
  SDK_VERSION,
  SUPPORTED_API_SCHEMA_VERSION,
  SUPPORTED_API_VERSION,
  SUPPORTED_PROGRAM_ID,
  SUPPORTED_PROGRAM_VERSION,
  StrykeSdkError,
  type ExecutableQuote,
} from "@stryke/sdk";

import { parseReferenceBotConfig } from "./config.js";
import { decideEntry } from "./entry.js";
import { emitDecision } from "./logging.js";
import { estimateFairProbability } from "./strategy.js";
import { loadWalletForLiveTrading } from "./wallet.js";

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
    priceHistory: [{ price: 100_000, publishTime: Math.floor(Date.now() / 1000) }],
  };
  const config = parseReferenceBotConfig({ killSwitchEnabled: false });
  const decision = decideEntry({
    fairProbability: estimateFairProbability(input),
    quote: sampleQuote,
    config,
    secondsRemaining: input.secondsRemaining,
    tradeSizeSol: 0.01,
    aggregateExposureSol: 0,
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
  const wallet = await loadWalletForLiveTrading(config, async (path) => {
    const module = (await import(path)) as { default?: unknown };
    if (module.default === undefined) throw new StrykeSdkError("configuration", "Wallet adapter has no default export");
    return module.default;
  });
  if (!wallet) throw new StrykeSdkError("configuration", "Live gates are not all enabled");
  console.log(JSON.stringify({ event: "live_gate_ready", ...compatibility }));
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
