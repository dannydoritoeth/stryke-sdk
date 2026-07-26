import { StrykeSdkError, type PilotAsset, type PilotExpiryFamily } from "@stryke/sdk";
import { resolve } from "node:path";

import type { ReferenceEstimator } from "./strategy.js";

export type ReferenceBotConfig = {
  profile: ReferenceBotProfile;
  asset: PilotAsset;
  expiryFamily: PilotExpiryFamily;
  side: "yes" | "no";
  estimator: ReferenceEstimator;
  historyLookbackSeconds: Record<PilotExpiryFamily, number>;
  minimumHistoryCoverageBps: number;
  minimumVolatilityBpsPerSqrtHour: number;
  maximumVolatilityBpsPerSqrtHour: number;
  maximumModelProbabilityBps: number;
  tradeSizeLamports: bigint;
  maximumTradeSizeLamports: bigint;
  maximumAggregateExposureLamports: bigint;
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
  walletAdapterPath?: string;
};

export type ReferenceBotProfile = "paper" | "devnet" | "live";

export const referenceBotDefaults: ReferenceBotConfig = {
  profile: "paper",
  asset: "BTC",
  expiryFamily: "five_minute",
  side: "yes",
  estimator: "distance_to_strike",
  tradeSizeLamports: 1_000_000n,
  maximumTradeSizeLamports: 10_000_000n,
  maximumAggregateExposureLamports: 50_000_000n,
  minimumEntryEdgeBps: 500,
  maximumPriceImpactBps: 100,
  minimumSecondsToExpiry: 60,
  maximumOpenPositions: 1,
  tickIntervalMs: 5_000,
  stopLossBps: 1_000,
  takeProfitBps: 2_000,
  priceHistoryMaxPoints: 20_000,
  historyLookbackSeconds: { one_minute: 180, five_minute: 600, fifteen_minute: 1_800, hourly: 10_800 },
  minimumHistoryCoverageBps: 8_000,
  minimumVolatilityBpsPerSqrtHour: 5,
  maximumVolatilityBpsPerSqrtHour: 2_000,
  maximumModelProbabilityBps: 9_500,
  readOnlyMode: true,
  liveTradingEnabled: false,
  killSwitchEnabled: true,
  pythHermesUrl: "https://hermes.pyth.network",
  checkpointPath: ".stryke/reference-bot-action.json",
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
  if (!["yes", "no"].includes(config.side)) configurationError("side");
  if (!["distance_to_strike", "distance_momentum", "volatility_adjusted_probability"].includes(config.estimator)) configurationError("estimator");
  for (const key of ["readOnlyMode", "liveTradingEnabled", "killSwitchEnabled"] as const) {
    if (typeof config[key] !== "boolean") configurationError(key);
  }
  for (const key of ["tradeSizeLamports", "maximumTradeSizeLamports", "maximumAggregateExposureLamports"] as const) {
    if (typeof config[key] !== "bigint" || config[key] <= 0n) configurationError(key);
  }
  config.minimumEntryEdgeBps = integer(config.minimumEntryEdgeBps, "minimumEntryEdgeBps", 0, 10_000);
  config.maximumPriceImpactBps = integer(config.maximumPriceImpactBps, "maximumPriceImpactBps", 0, 9_999);
  config.minimumSecondsToExpiry = integer(config.minimumSecondsToExpiry, "minimumSecondsToExpiry", 0, Number.MAX_SAFE_INTEGER);
  config.maximumOpenPositions = integer(config.maximumOpenPositions, "maximumOpenPositions", 1, 1);
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
  if (config.tradeSizeLamports > config.maximumTradeSizeLamports) configurationError("tradeSizeLamports");
  if (config.maximumAggregateExposureLamports < config.maximumTradeSizeLamports) configurationError("maximumAggregateExposureLamports");
  for (const key of ["apiBaseUrl", "solanaRpcUrl", "pythHermesUrl", "walletAdapterPath"] as const) {
    if (config[key] !== undefined && (typeof config[key] !== "string" || !config[key])) configurationError(key);
  }
  if (typeof config.checkpointPath !== "string" || !config.checkpointPath) configurationError("checkpointPath");
  return config;
};

export const parseReferenceBotEnv = (
  env: NodeJS.ProcessEnv = process.env,
  profile: ReferenceBotProfile = "paper"
): ReferenceBotConfig => {
  if (profile === "live") {
    throw new StrykeSdkError(
      "configuration",
      "Mainnet live trading is not approved or compatible with this devnet pilot"
    );
  }
  const profiledEnv: NodeJS.ProcessEnv = {
    ...env,
    STRYKE_READ_ONLY_MODE: profile === "paper" ? "true" : "false",
    STRYKE_LIVE_TRADING_ENABLED: profile === "devnet" ? "true" : "false",
    STRYKE_KILL_SWITCH_ENABLED: profile === "devnet" ? "false" : "true",
  };
  const readOnlyMode = booleanEnv(profiledEnv, "STRYKE_READ_ONLY_MODE", true);
  const liveTradingEnabled = booleanEnv(profiledEnv, "STRYKE_LIVE_TRADING_ENABLED", false);
  const killSwitchEnabled = booleanEnv(profiledEnv, "STRYKE_KILL_SWITCH_ENABLED", true);
  const activeLive = !readOnlyMode && liveTradingEnabled && !killSwitchEnabled;
  const required = (name: string, fallback?: string): string => {
    const value = profiledEnv[name] ?? fallback;
    if (value === undefined || (activeLive && profiledEnv[name] === undefined)) return configurationError(name);
    return value;
  };
  const asset = required("STRYKE_ASSET", referenceBotDefaults.asset) as PilotAsset;
  const expiryFamily = required("STRYKE_EXPIRY_FAMILY", referenceBotDefaults.expiryFamily) as PilotExpiryFamily;
  const side = required("STRYKE_SIDE", referenceBotDefaults.side) as "yes" | "no";
  const estimator = required("STRYKE_ESTIMATOR", referenceBotDefaults.estimator) as ReferenceEstimator;
  const sol = (name: string, fallback: bigint) => solToLamports(required(name, `${Number(fallback) / 1e9}`), name);
  const numeric = (name: string, fallback: number) => {
    if (activeLive) required(name);
    return numberEnv(profiledEnv, name, fallback);
  };
  const config = parseReferenceBotConfig({
    profile, asset, expiryFamily, side, estimator,
    tradeSizeLamports: sol("STRYKE_TRADE_SIZE_SOL", referenceBotDefaults.tradeSizeLamports),
    maximumTradeSizeLamports: sol("STRYKE_MAXIMUM_TRADE_SIZE_SOL", referenceBotDefaults.maximumTradeSizeLamports),
    maximumAggregateExposureLamports: sol("STRYKE_MAXIMUM_AGGREGATE_EXPOSURE_SOL", referenceBotDefaults.maximumAggregateExposureLamports),
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
    readOnlyMode, liveTradingEnabled, killSwitchEnabled,
    checkpointPath: profiledEnv.STRYKE_CHECKPOINT_PATH ?? referenceBotDefaults.checkpointPath,
    pythHermesUrl: profiledEnv.STRYKE_PYTH_HERMES_URL ?? referenceBotDefaults.pythHermesUrl,
    ...(profiledEnv.STRYKE_API_BASE_URL ? { apiBaseUrl: profiledEnv.STRYKE_API_BASE_URL } : {}),
    ...(profiledEnv.STRYKE_SOLANA_RPC_URL ? { solanaRpcUrl: profiledEnv.STRYKE_SOLANA_RPC_URL } : {}),
    ...(profiledEnv.STRYKE_WALLET_ADAPTER_PATH ? { walletAdapterPath: profiledEnv.STRYKE_WALLET_ADAPTER_PATH } : {}),
  });
  if (activeLive && (!config.apiBaseUrl || !config.solanaRpcUrl || !config.walletAdapterPath)) {
    configurationError("live endpoints and wallet adapter");
  }
  return config;
};

export const publicConfig = (config: ReferenceBotConfig) => ({
  ...config,
  tradeSizeLamports: config.tradeSizeLamports.toString(),
  maximumTradeSizeLamports: config.maximumTradeSizeLamports.toString(),
  maximumAggregateExposureLamports: config.maximumAggregateExposureLamports.toString(),
  walletAdapterPath: config.walletAdapterPath ? "[configured]" : undefined,
});

export const resolveReferenceBotRuntimeBindings = (
  config: ReferenceBotConfig,
  cwd = process.env.INIT_CWD ?? process.cwd()
) => ({
  apiBaseUrl: config.apiBaseUrl,
  solanaRpcUrl: config.solanaRpcUrl ?? "http://127.0.0.1:8899",
  pythHermesUrl: config.pythHermesUrl,
  checkpointPath: resolve(cwd, config.checkpointPath),
  walletAdapterPath: config.walletAdapterPath
    ? resolve(cwd, config.walletAdapterPath)
    : undefined,
});
