import { StrykeSdkError, type PilotAsset, type PilotExpiryFamily } from "@stryketrade/sdk";
import { resolve } from "node:path";

import type { ReferenceEstimator } from "./strategy.js";

export type ReferenceStrategy = "baseline" | "polymarket_early" | "polymarket_late";

export type ReferenceBotConfig = {
  profile: ReferenceBotProfile;
  asset: PilotAsset;
  expiryFamily: PilotExpiryFamily;
  strategy: ReferenceStrategy;
  estimator: ReferenceEstimator;
  historyLookbackSeconds: Record<PilotExpiryFamily, number>;
  minimumHistoryCoverageBps: number;
  minimumVolatilityBpsPerSqrtHour: number;
  maximumVolatilityBpsPerSqrtHour: number;
  maximumModelProbabilityBps: number;
  polymarketEntryEdgeBps: number;
  polymarketExitEdgeBps: number;
  polymarketMaximumSpreadBps: number;
  polymarketMaximumPriceAgeMs: number;
  polymarketTimeoutMs: number;
  polymarketClobUrl: string;
  polymarketEarlyWindowSeconds: number;
  polymarketLateWindowSeconds: number;
  polymarketSubmissionBufferSeconds: number;
  polymarketMinimumHoldReturnBps: number;
  polymarketMinimumWinProfitBps: number;
  polymarketBootstrapEmptyMarket: boolean;
  polymarketPreFeeRevalidationEnabled: boolean;
  polymarketEarlyExitPolicy: "hold_to_expiry" | "exit_on_convergence" | "risk_managed";
  tradeSizeLamports: bigint;
  maximumTradeSizeLamports: bigint;
  maximumAggregateExposureLamports: bigint;
  feeFreeActivationLimitLamports: bigint;
  feeFreeBufferLamports: bigint;
  minimumEntryEdgeBps: number;
  maximumPriceImpactBps: number;
  minimumSecondsToExpiry: number;
  maximumOpenPositions: number;
  tickIntervalMs: number;
  stopLossBps: number;
  takeProfitBps: number;
  priceHistoryMaxPoints: number;
  readOnlyMode: boolean;
  liveTradingEnabled: boolean;
  killSwitchEnabled: boolean;
  apiBaseUrl?: string;
  solanaRpcUrl?: string;
  pythHermesUrl: string;
  checkpointPath: string;
  roundStatePath: string;
  stateBackend: "file" | "postgres";
  stateDatabaseUrl?: string;
  stateDatabasePoolMax: number;
  stateDatabasePoolConnectionTimeoutMs: number;
  stateDatabasePoolIdleTimeoutMs: number;
  stateDatabasePoolMaxLifetimeSeconds: number;
  stateNamespace: string;
  leaseTtlMs: number;
  walletAdapterPath?: string;
};

export type ReferenceBotProfile = "paper" | "devnet" | "live";

export const referenceBotDefaults: ReferenceBotConfig = {
  profile: "paper",
  asset: "BTC",
  expiryFamily: "five_minute",
  strategy: "baseline",
  estimator: "volatility_adjusted_probability",
  tradeSizeLamports: 10_000n,
  maximumTradeSizeLamports: 10_000n,
  maximumAggregateExposureLamports: 30_000n,
  feeFreeActivationLimitLamports: 10_000_000_000n,
  feeFreeBufferLamports: 500_000_000n,
  minimumEntryEdgeBps: 500,
  maximumPriceImpactBps: 100,
  minimumSecondsToExpiry: 60,
  maximumOpenPositions: 3,
  tickIntervalMs: 5_000,
  stopLossBps: 1_000,
  takeProfitBps: 2_000,
  priceHistoryMaxPoints: 20_000,
  historyLookbackSeconds: { one_minute: 180, five_minute: 600, fifteen_minute: 1_800, hourly: 10_800 },
  minimumHistoryCoverageBps: 8_000,
  minimumVolatilityBpsPerSqrtHour: 5,
  maximumVolatilityBpsPerSqrtHour: 2_000,
  maximumModelProbabilityBps: 9_500,
  polymarketEntryEdgeBps: 500,
  polymarketExitEdgeBps: 200,
  polymarketMaximumSpreadBps: 1_000,
  polymarketMaximumPriceAgeMs: 5_000,
  polymarketTimeoutMs: 3_000,
  polymarketClobUrl: "https://clob.polymarket.com",
  polymarketEarlyWindowSeconds: 60,
  polymarketLateWindowSeconds: 20,
  polymarketSubmissionBufferSeconds: 3,
  polymarketMinimumHoldReturnBps: 100,
  polymarketMinimumWinProfitBps: 100,
  polymarketBootstrapEmptyMarket: true,
  polymarketPreFeeRevalidationEnabled: false,
  polymarketEarlyExitPolicy: "exit_on_convergence",
  readOnlyMode: true,
  liveTradingEnabled: false,
  killSwitchEnabled: true,
  apiBaseUrl: "https://api.stryketrade.com",
  solanaRpcUrl: "https://api.mainnet-beta.solana.com",
  pythHermesUrl: "https://hermes.pyth.network",
  checkpointPath: ".stryke/reference-bot-action.json",
  roundStatePath: ".stryke/reference-bot-rounds.json",
  stateBackend: "file",
  stateDatabasePoolMax: 2,
  stateDatabasePoolConnectionTimeoutMs: 5_000,
  stateDatabasePoolIdleTimeoutMs: 30_000,
  stateDatabasePoolMaxLifetimeSeconds: 300,
  stateNamespace: "default",
  leaseTtlMs: 30_000,
};

const configurationError = (name: string): never => {
  throw new StrykeSdkError("configuration", `Invalid reference bot config: ${name}`);
};

const integer = (value: unknown, name: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return configurationError(name);
  }
  return value as number;
};

const solToLamports = (value: string, name: string): bigint => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value)) return configurationError(name);
  const [whole, fraction = ""] = value.split(".");
  const lamports = BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
  if (lamports <= 0n) return configurationError(name);
  return lamports;
};

const booleanEnv = (env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean => {
  const value = env[name];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return configurationError(name);
};

const numberEnv = (env: NodeJS.ProcessEnv, name: string, fallback: number): number => {
  const value = env[name];
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return configurationError(name);
  return Number(value);
};

export const parseReferenceBotConfig = (
  input: Partial<ReferenceBotConfig> & Record<string, unknown>
): ReferenceBotConfig => {
  for (const forbidden of ["privateKey", "seedPhrase", "mnemonic", "secretKey"]) {
    if (input[forbidden] !== undefined) throw new StrykeSdkError("configuration", "Inline wallet secrets are not supported");
  }
  const config = {
    ...referenceBotDefaults,
    ...input,
    historyLookbackSeconds: {
      ...referenceBotDefaults.historyLookbackSeconds,
      ...((input.historyLookbackSeconds as Partial<Record<PilotExpiryFamily, number>> | undefined) ?? {}),
    },
  } as ReferenceBotConfig;
  if (!["paper", "devnet", "live"].includes(config.profile)) configurationError("profile");
  if (!["BTC", "SOL"].includes(config.asset)) configurationError("asset");
  if (!["one_minute", "five_minute", "fifteen_minute", "hourly"].includes(config.expiryFamily)) configurationError("expiryFamily");
  if (!["baseline", "polymarket_early", "polymarket_late"].includes(config.strategy)) configurationError("strategy");
  if (!["distance_to_strike", "distance_momentum", "volatility_adjusted_probability"].includes(config.estimator)) configurationError("estimator");
  if (config.strategy.startsWith("polymarket_") && config.expiryFamily === "one_minute") configurationError("expiryFamily: Polymarket strategies require 5m, 15m, or 1h aligned markets");
  if (!["hold_to_expiry", "exit_on_convergence", "risk_managed"].includes(config.polymarketEarlyExitPolicy)) configurationError("polymarketEarlyExitPolicy");
  if (config.strategy === "polymarket_late" && config.polymarketEarlyExitPolicy !== "hold_to_expiry") configurationError("polymarketEarlyExitPolicy: late strategy must hold_to_expiry");
  for (const key of ["readOnlyMode", "liveTradingEnabled", "killSwitchEnabled", "polymarketBootstrapEmptyMarket", "polymarketPreFeeRevalidationEnabled"] as const) {
    if (typeof config[key] !== "boolean") configurationError(key);
  }
  for (const key of ["tradeSizeLamports", "maximumTradeSizeLamports", "maximumAggregateExposureLamports", "feeFreeActivationLimitLamports"] as const) {
    if (typeof config[key] !== "bigint" || config[key] <= 0n) configurationError(key);
  }
  if (typeof config.feeFreeBufferLamports !== "bigint" || config.feeFreeBufferLamports < 0n) configurationError("feeFreeBufferLamports");
  config.minimumEntryEdgeBps = integer(config.minimumEntryEdgeBps, "minimumEntryEdgeBps", 0, 10_000);
  config.maximumPriceImpactBps = integer(config.maximumPriceImpactBps, "maximumPriceImpactBps", 0, 9_999);
  config.minimumSecondsToExpiry = integer(config.minimumSecondsToExpiry, "minimumSecondsToExpiry", 0, Number.MAX_SAFE_INTEGER);
  config.maximumOpenPositions = integer(config.maximumOpenPositions, "maximumOpenPositions", 1, 100);
  config.tickIntervalMs = integer(config.tickIntervalMs, "tickIntervalMs", 1_000, Number.MAX_SAFE_INTEGER);
  config.stopLossBps = integer(config.stopLossBps, "stopLossBps", 1, 10_000);
  config.takeProfitBps = integer(config.takeProfitBps, "takeProfitBps", 1, Number.MAX_SAFE_INTEGER);
  config.priceHistoryMaxPoints = integer(config.priceHistoryMaxPoints, "priceHistoryMaxPoints", 2, 100_000);
  const lookbackBounds: Record<PilotExpiryFamily, readonly [number, number]> = {
    one_minute: [60, 300], five_minute: [300, 1_200], fifteen_minute: [900, 3_600], hourly: [3_600, 21_600],
  };
  for (const family of Object.keys(lookbackBounds) as PilotExpiryFamily[]) {
    config.historyLookbackSeconds[family] = integer(config.historyLookbackSeconds[family], `historyLookbackSeconds.${family}`, ...lookbackBounds[family]);
  }
  config.minimumHistoryCoverageBps = integer(config.minimumHistoryCoverageBps, "minimumHistoryCoverageBps", 1, 10_000);
  config.minimumVolatilityBpsPerSqrtHour = integer(config.minimumVolatilityBpsPerSqrtHour, "minimumVolatilityBpsPerSqrtHour", 1, 100_000);
  config.maximumVolatilityBpsPerSqrtHour = integer(config.maximumVolatilityBpsPerSqrtHour, "maximumVolatilityBpsPerSqrtHour", config.minimumVolatilityBpsPerSqrtHour, 100_000);
  config.maximumModelProbabilityBps = integer(config.maximumModelProbabilityBps, "maximumModelProbabilityBps", 5_001, 9_999);
  config.polymarketEntryEdgeBps = integer(config.polymarketEntryEdgeBps, "polymarketEntryEdgeBps", 1, 10_000);
  config.polymarketExitEdgeBps = integer(config.polymarketExitEdgeBps, "polymarketExitEdgeBps", 0, 9_999);
  config.polymarketMaximumSpreadBps = integer(config.polymarketMaximumSpreadBps, "polymarketMaximumSpreadBps", 0, 10_000);
  config.polymarketMaximumPriceAgeMs = integer(config.polymarketMaximumPriceAgeMs, "polymarketMaximumPriceAgeMs", 1, 60_000);
  config.polymarketTimeoutMs = integer(config.polymarketTimeoutMs, "polymarketTimeoutMs", 1, 30_000);
  config.polymarketEarlyWindowSeconds = integer(config.polymarketEarlyWindowSeconds, "polymarketEarlyWindowSeconds", 1, 3_600);
  config.polymarketLateWindowSeconds = integer(config.polymarketLateWindowSeconds, "polymarketLateWindowSeconds", 1, 600);
  config.polymarketSubmissionBufferSeconds = integer(config.polymarketSubmissionBufferSeconds, "polymarketSubmissionBufferSeconds", 1, 60);
  config.polymarketMinimumHoldReturnBps = integer(config.polymarketMinimumHoldReturnBps, "polymarketMinimumHoldReturnBps", 0, 100_000);
  config.polymarketMinimumWinProfitBps = integer(config.polymarketMinimumWinProfitBps, "polymarketMinimumWinProfitBps", 0, 100_000);
  if (config.polymarketSubmissionBufferSeconds >= config.polymarketLateWindowSeconds) configurationError("polymarketSubmissionBufferSeconds");
  if (config.polymarketExitEdgeBps >= config.polymarketEntryEdgeBps) configurationError("polymarketExitEdgeBps");
  if (config.tradeSizeLamports > config.maximumTradeSizeLamports) configurationError("tradeSizeLamports");
  if (config.maximumAggregateExposureLamports < config.maximumTradeSizeLamports) configurationError("maximumAggregateExposureLamports");
  if (config.feeFreeBufferLamports >= config.feeFreeActivationLimitLamports) configurationError("feeFreeBufferLamports");
  for (const key of ["apiBaseUrl", "solanaRpcUrl", "pythHermesUrl", "polymarketClobUrl", "walletAdapterPath"] as const) {
    if (config[key] !== undefined && (typeof config[key] !== "string" || !config[key])) configurationError(key);
  }
  if (typeof config.checkpointPath !== "string" || !config.checkpointPath) configurationError("checkpointPath");
  if (typeof config.roundStatePath !== "string" || !config.roundStatePath) configurationError("roundStatePath");
  if (!["file", "postgres"].includes(config.stateBackend)) configurationError("stateBackend");
  if (typeof config.stateNamespace !== "string" || !config.stateNamespace) configurationError("stateNamespace");
  config.leaseTtlMs = integer(config.leaseTtlMs, "leaseTtlMs", 5_000, 300_000);
  config.stateDatabasePoolMax = integer(config.stateDatabasePoolMax, "stateDatabasePoolMax", 1, 20);
  config.stateDatabasePoolConnectionTimeoutMs = integer(config.stateDatabasePoolConnectionTimeoutMs, "stateDatabasePoolConnectionTimeoutMs", 1, 60_000);
  config.stateDatabasePoolIdleTimeoutMs = integer(config.stateDatabasePoolIdleTimeoutMs, "stateDatabasePoolIdleTimeoutMs", 1, 300_000);
  config.stateDatabasePoolMaxLifetimeSeconds = integer(config.stateDatabasePoolMaxLifetimeSeconds, "stateDatabasePoolMaxLifetimeSeconds", 1, 86_400);
  if (config.stateBackend === "postgres" && (typeof config.stateDatabaseUrl !== "string" || !config.stateDatabaseUrl)) configurationError("stateDatabaseUrl");
  return config;
};

export const parseReferenceBotEnv = (
  env: NodeJS.ProcessEnv = process.env,
  profile: ReferenceBotProfile = "paper"
): ReferenceBotConfig => {
  const profiledEnv: NodeJS.ProcessEnv = {
    ...env,
    STRYKE_READ_ONLY_MODE: profile === "paper" ? "true" : "false",
    STRYKE_LIVE_TRADING_ENABLED: profile === "paper" ? "false" : "true",
    STRYKE_KILL_SWITCH_ENABLED: profile === "paper" ? "true" : "false",
  };
  const readOnlyMode = booleanEnv(profiledEnv, "STRYKE_READ_ONLY_MODE", true);
  const liveTradingEnabled = booleanEnv(profiledEnv, "STRYKE_LIVE_TRADING_ENABLED", false);
  const killSwitchEnabled = booleanEnv(profiledEnv, "STRYKE_KILL_SWITCH_ENABLED", true);
  const activeLive = !readOnlyMode && liveTradingEnabled && !killSwitchEnabled;
  const requiresExplicitControls = profile === "devnet";
  const required = (name: string, fallback?: string): string => {
    const value = profiledEnv[name] ?? fallback;
    if (value === undefined || (requiresExplicitControls && profiledEnv[name] === undefined)) return configurationError(name);
    return value;
  };
  const asset = required("STRYKE_ASSET", referenceBotDefaults.asset) as PilotAsset;
  const expiryFamily = required("STRYKE_EXPIRY_FAMILY", referenceBotDefaults.expiryFamily) as PilotExpiryFamily;
  const strategy = required("STRYKE_STRATEGY", referenceBotDefaults.strategy) as ReferenceStrategy;
  const estimator = required("STRYKE_ESTIMATOR", referenceBotDefaults.estimator) as ReferenceEstimator;
  const sol = (name: string, fallback: bigint) => solToLamports(required(name, `${Number(fallback) / 1e9}`), name);
  const numeric = (name: string, fallback: number) => {
    if (requiresExplicitControls) required(name);
    return numberEnv(profiledEnv, name, fallback);
  };
  const config = parseReferenceBotConfig({
    profile, asset, expiryFamily, strategy, estimator,
    tradeSizeLamports: sol("STRYKE_TRADE_SIZE_SOL", referenceBotDefaults.tradeSizeLamports),
    maximumTradeSizeLamports: sol("STRYKE_MAXIMUM_TRADE_SIZE_SOL", referenceBotDefaults.maximumTradeSizeLamports),
    maximumAggregateExposureLamports: sol("STRYKE_MAXIMUM_AGGREGATE_EXPOSURE_SOL", referenceBotDefaults.maximumAggregateExposureLamports),
    feeFreeActivationLimitLamports: sol("STRYKE_FEE_FREE_ACTIVATION_LIMIT_SOL", referenceBotDefaults.feeFreeActivationLimitLamports),
    feeFreeBufferLamports: profiledEnv.STRYKE_FEE_FREE_BUFFER_SOL === "0" ? 0n : sol("STRYKE_FEE_FREE_BUFFER_SOL", referenceBotDefaults.feeFreeBufferLamports),
    minimumEntryEdgeBps: numeric("STRYKE_MINIMUM_ENTRY_EDGE_BPS", referenceBotDefaults.minimumEntryEdgeBps),
    maximumPriceImpactBps: numeric("STRYKE_MAXIMUM_PRICE_IMPACT_BPS", referenceBotDefaults.maximumPriceImpactBps),
    minimumSecondsToExpiry: numeric("STRYKE_MINIMUM_SECONDS_TO_EXPIRY", referenceBotDefaults.minimumSecondsToExpiry),
    maximumOpenPositions: numeric("STRYKE_MAXIMUM_OPEN_POSITIONS", referenceBotDefaults.maximumOpenPositions),
    tickIntervalMs: numeric("STRYKE_TICK_INTERVAL_MS", referenceBotDefaults.tickIntervalMs),
    stopLossBps: numeric("STRYKE_STOP_LOSS_BPS", referenceBotDefaults.stopLossBps),
    takeProfitBps: numeric("STRYKE_TAKE_PROFIT_BPS", referenceBotDefaults.takeProfitBps),
    priceHistoryMaxPoints: numeric("STRYKE_PRICE_HISTORY_MAX_POINTS", referenceBotDefaults.priceHistoryMaxPoints),
    historyLookbackSeconds: {
      one_minute: numeric("STRYKE_HISTORY_LOOKBACK_SECONDS_1M", referenceBotDefaults.historyLookbackSeconds.one_minute),
      five_minute: numeric("STRYKE_HISTORY_LOOKBACK_SECONDS_5M", referenceBotDefaults.historyLookbackSeconds.five_minute),
      fifteen_minute: numeric("STRYKE_HISTORY_LOOKBACK_SECONDS_15M", referenceBotDefaults.historyLookbackSeconds.fifteen_minute),
      hourly: numeric("STRYKE_HISTORY_LOOKBACK_SECONDS_1H", referenceBotDefaults.historyLookbackSeconds.hourly),
    },
    minimumHistoryCoverageBps: numeric("STRYKE_MINIMUM_HISTORY_COVERAGE_BPS", referenceBotDefaults.minimumHistoryCoverageBps),
    minimumVolatilityBpsPerSqrtHour: numeric("STRYKE_MINIMUM_VOLATILITY_BPS_PER_SQRT_HOUR", referenceBotDefaults.minimumVolatilityBpsPerSqrtHour),
    maximumVolatilityBpsPerSqrtHour: numeric("STRYKE_MAXIMUM_VOLATILITY_BPS_PER_SQRT_HOUR", referenceBotDefaults.maximumVolatilityBpsPerSqrtHour),
    maximumModelProbabilityBps: numeric("STRYKE_MAXIMUM_MODEL_PROBABILITY_BPS", referenceBotDefaults.maximumModelProbabilityBps),
    polymarketEntryEdgeBps: numeric("STRYKE_POLY_ENTRY_EDGE_BPS", referenceBotDefaults.polymarketEntryEdgeBps),
    polymarketExitEdgeBps: numeric("STRYKE_POLY_EXIT_EDGE_BPS", referenceBotDefaults.polymarketExitEdgeBps),
    polymarketMaximumSpreadBps: numeric("STRYKE_POLY_MAX_SPREAD_BPS", referenceBotDefaults.polymarketMaximumSpreadBps),
    polymarketMaximumPriceAgeMs: numeric("STRYKE_POLY_MAX_PRICE_AGE_MS", referenceBotDefaults.polymarketMaximumPriceAgeMs),
    polymarketTimeoutMs: numeric("STRYKE_POLY_TIMEOUT_MS", referenceBotDefaults.polymarketTimeoutMs),
    polymarketClobUrl: profiledEnv.STRYKE_POLYMARKET_CLOB_URL ?? referenceBotDefaults.polymarketClobUrl,
    polymarketEarlyWindowSeconds: numeric("STRYKE_POLY_EARLY_WINDOW_SECONDS", referenceBotDefaults.polymarketEarlyWindowSeconds),
    polymarketLateWindowSeconds: numeric("STRYKE_POLY_LATE_WINDOW_SECONDS", referenceBotDefaults.polymarketLateWindowSeconds),
    polymarketSubmissionBufferSeconds: numeric("STRYKE_POLY_SUBMISSION_BUFFER_SECONDS", referenceBotDefaults.polymarketSubmissionBufferSeconds),
    polymarketMinimumHoldReturnBps: numeric("STRYKE_POLY_MIN_HOLD_RETURN_BPS", referenceBotDefaults.polymarketMinimumHoldReturnBps),
    polymarketMinimumWinProfitBps: numeric("STRYKE_POLY_MIN_WIN_PROFIT_BPS", referenceBotDefaults.polymarketMinimumWinProfitBps),
    polymarketBootstrapEmptyMarket: booleanEnv(profiledEnv, "STRYKE_POLY_BOOTSTRAP_EMPTY_MARKET", referenceBotDefaults.polymarketBootstrapEmptyMarket),
    polymarketPreFeeRevalidationEnabled: booleanEnv(profiledEnv, "STRYKE_POLY_PRE_FEE_REVALIDATION_ENABLED", referenceBotDefaults.polymarketPreFeeRevalidationEnabled),
    polymarketEarlyExitPolicy: (profiledEnv.STRYKE_POLY_EXIT_POLICY ?? referenceBotDefaults.polymarketEarlyExitPolicy) as ReferenceBotConfig["polymarketEarlyExitPolicy"],
    readOnlyMode, liveTradingEnabled, killSwitchEnabled,
    checkpointPath: profiledEnv.STRYKE_CHECKPOINT_PATH ?? referenceBotDefaults.checkpointPath,
    roundStatePath: profiledEnv.STRYKE_ROUND_STATE_PATH ?? referenceBotDefaults.roundStatePath,
    stateBackend: (profiledEnv.STRYKE_STATE_BACKEND ?? referenceBotDefaults.stateBackend) as ReferenceBotConfig["stateBackend"],
    stateNamespace: profiledEnv.STRYKE_STATE_NAMESPACE ?? referenceBotDefaults.stateNamespace,
    leaseTtlMs: numberEnv(profiledEnv, "STRYKE_LEASE_TTL_MS", referenceBotDefaults.leaseTtlMs),
    stateDatabasePoolMax: numberEnv(profiledEnv, "STRYKE_DATABASE_POOL_MAX", referenceBotDefaults.stateDatabasePoolMax),
    stateDatabasePoolConnectionTimeoutMs: numberEnv(profiledEnv, "STRYKE_DATABASE_POOL_CONNECTION_TIMEOUT_MS", referenceBotDefaults.stateDatabasePoolConnectionTimeoutMs),
    stateDatabasePoolIdleTimeoutMs: numberEnv(profiledEnv, "STRYKE_DATABASE_POOL_IDLE_TIMEOUT_MS", referenceBotDefaults.stateDatabasePoolIdleTimeoutMs),
    stateDatabasePoolMaxLifetimeSeconds: numberEnv(profiledEnv, "STRYKE_DATABASE_POOL_MAX_LIFETIME_SECONDS", referenceBotDefaults.stateDatabasePoolMaxLifetimeSeconds),
    pythHermesUrl: profiledEnv.STRYKE_PYTH_HERMES_URL ?? referenceBotDefaults.pythHermesUrl,
    ...(profiledEnv.STRYKE_API_BASE_URL ? { apiBaseUrl: profiledEnv.STRYKE_API_BASE_URL } : {}),
    ...(profiledEnv.STRYKE_SOLANA_RPC_URL ? { solanaRpcUrl: profiledEnv.STRYKE_SOLANA_RPC_URL } : {}),
    ...(profiledEnv.STRYKE_WALLET_ADAPTER_PATH ? { walletAdapterPath: profiledEnv.STRYKE_WALLET_ADAPTER_PATH } : {}),
    ...(profiledEnv.STRYKE_DATABASE_URL ? { stateDatabaseUrl: profiledEnv.STRYKE_DATABASE_URL } : {}),
  });
  if (profile === "devnet" && (!config.apiBaseUrl || !config.solanaRpcUrl || !config.walletAdapterPath)) {
    configurationError("devnet endpoints and wallet adapter");
  }
  if (activeLive && !config.walletAdapterPath) {
    configurationError("STRYKE_WALLET_ADAPTER_PATH");
  }
  return config;
};

const publicEndpoint = (value: string | undefined): string | undefined =>
  value ? new URL(value).origin : undefined;

export const publicConfig = (config: ReferenceBotConfig) => ({
  ...config,
  tradeSizeLamports: config.tradeSizeLamports.toString(),
  maximumTradeSizeLamports: config.maximumTradeSizeLamports.toString(),
  maximumAggregateExposureLamports: config.maximumAggregateExposureLamports.toString(),
  feeFreeActivationLimitLamports: config.feeFreeActivationLimitLamports.toString(),
  feeFreeBufferLamports: config.feeFreeBufferLamports.toString(),
  apiBaseUrl: publicEndpoint(config.apiBaseUrl),
  solanaRpcUrl: publicEndpoint(config.solanaRpcUrl),
  pythHermesUrl: publicEndpoint(config.pythHermesUrl),
  polymarketClobUrl: publicEndpoint(config.polymarketClobUrl),
  walletAdapterPath: config.walletAdapterPath ? "[configured]" : undefined,
  stateDatabaseUrl: config.stateDatabaseUrl ? "[configured]" : undefined,
});

export const resolveReferenceBotRuntimeBindings = (
  config: ReferenceBotConfig,
  cwd = process.env.INIT_CWD ?? process.cwd()
) => ({
  apiBaseUrl: config.apiBaseUrl,
  solanaRpcUrl: config.solanaRpcUrl ?? "http://127.0.0.1:8899",
  pythHermesUrl: config.pythHermesUrl,
  checkpointPath: resolve(cwd, config.checkpointPath),
  roundStatePath: resolve(cwd, config.roundStatePath),
  walletAdapterPath: config.walletAdapterPath
    ? resolve(cwd, config.walletAdapterPath)
    : undefined,
});
