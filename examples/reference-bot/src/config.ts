import { StrykeSdkError, type PilotAsset, type PilotExpiryFamily } from "@stryke/sdk";

import type { BaselineEstimator } from "./strategy.js";

export type ReferenceBotConfig = {
  asset: PilotAsset;
  expiryFamily: PilotExpiryFamily;
  side: "yes" | "no";
  estimator: BaselineEstimator;
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
  checkpointPath: string;
  walletAdapterPath?: string;
};

export const referenceBotDefaults: ReferenceBotConfig = {
  asset: "BTC",
  expiryFamily: "five_minute",
  side: "yes",
  estimator: "distance_to_strike",
  tradeSizeLamports: 1_000_000n,
  maximumTradeSizeLamports: 10_000_000n,
  maximumAggregateExposureLamports: 50_000_000n,
  minimumEntryEdgeBps: 200,
  maximumPriceImpactBps: 100,
  minimumSecondsToExpiry: 60,
  maximumOpenPositions: 3,
  tickIntervalMs: 5_000,
  stopLossBps: 1_000,
  takeProfitBps: 2_000,
  priceHistoryMaxPoints: 120,
  readOnlyMode: true,
  liveTradingEnabled: false,
  killSwitchEnabled: true,
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
  const config = { ...referenceBotDefaults, ...input } as ReferenceBotConfig;
  if (!["BTC", "SOL"].includes(config.asset)) configurationError("asset");
  if (!["one_minute", "five_minute", "fifteen_minute", "hourly"].includes(config.expiryFamily)) configurationError("expiryFamily");
  if (!["yes", "no"].includes(config.side)) configurationError("side");
  if (!["distance_to_strike", "distance_momentum"].includes(config.estimator)) configurationError("estimator");
  for (const key of ["readOnlyMode", "liveTradingEnabled", "killSwitchEnabled"] as const) {
    if (typeof config[key] !== "boolean") configurationError(key);
  }
  for (const key of ["tradeSizeLamports", "maximumTradeSizeLamports", "maximumAggregateExposureLamports"] as const) {
    if (typeof config[key] !== "bigint" || config[key] <= 0n) configurationError(key);
  }
  config.minimumEntryEdgeBps = integer(config.minimumEntryEdgeBps, "minimumEntryEdgeBps", 0, 10_000);
  config.maximumPriceImpactBps = integer(config.maximumPriceImpactBps, "maximumPriceImpactBps", 0, 9_999);
  config.minimumSecondsToExpiry = integer(config.minimumSecondsToExpiry, "minimumSecondsToExpiry", 0, Number.MAX_SAFE_INTEGER);
  config.maximumOpenPositions = integer(config.maximumOpenPositions, "maximumOpenPositions", 1, Number.MAX_SAFE_INTEGER);
  config.tickIntervalMs = integer(config.tickIntervalMs, "tickIntervalMs", 1_000, Number.MAX_SAFE_INTEGER);
  config.stopLossBps = integer(config.stopLossBps, "stopLossBps", 1, 10_000);
  config.takeProfitBps = integer(config.takeProfitBps, "takeProfitBps", 1, Number.MAX_SAFE_INTEGER);
  config.priceHistoryMaxPoints = integer(config.priceHistoryMaxPoints, "priceHistoryMaxPoints", 2, 10_000);
  if (config.tradeSizeLamports > config.maximumTradeSizeLamports) configurationError("tradeSizeLamports");
  if (config.maximumAggregateExposureLamports < config.maximumTradeSizeLamports) configurationError("maximumAggregateExposureLamports");
  for (const key of ["apiBaseUrl", "solanaRpcUrl", "walletAdapterPath"] as const) {
    if (config[key] !== undefined && (typeof config[key] !== "string" || !config[key])) configurationError(key);
  }
  if (typeof config.checkpointPath !== "string" || !config.checkpointPath) configurationError("checkpointPath");
  return config;
};

export const parseReferenceBotEnv = (env: NodeJS.ProcessEnv = process.env): ReferenceBotConfig => {
  const readOnlyMode = booleanEnv(env, "STRYKE_READ_ONLY_MODE", true);
  const liveTradingEnabled = booleanEnv(env, "STRYKE_LIVE_TRADING_ENABLED", false);
  const killSwitchEnabled = booleanEnv(env, "STRYKE_KILL_SWITCH_ENABLED", true);
  const activeLive = !readOnlyMode && liveTradingEnabled && !killSwitchEnabled;
  const required = (name: string, fallback?: string): string => {
    const value = env[name] ?? fallback;
    if (value === undefined || (activeLive && env[name] === undefined)) return configurationError(name);
    return value;
  };
  const asset = required("STRYKE_ASSET", referenceBotDefaults.asset) as PilotAsset;
  const expiryFamily = required("STRYKE_EXPIRY_FAMILY", referenceBotDefaults.expiryFamily) as PilotExpiryFamily;
  const side = required("STRYKE_SIDE", referenceBotDefaults.side) as "yes" | "no";
  const estimator = required("STRYKE_ESTIMATOR", referenceBotDefaults.estimator) as BaselineEstimator;
  const sol = (name: string, fallback: bigint) => solToLamports(required(name, `${Number(fallback) / 1e9}`), name);
  const config = parseReferenceBotConfig({
    asset, expiryFamily, side, estimator,
    tradeSizeLamports: sol("STRYKE_TRADE_SIZE_SOL", referenceBotDefaults.tradeSizeLamports),
    maximumTradeSizeLamports: sol("STRYKE_MAXIMUM_TRADE_SIZE_SOL", referenceBotDefaults.maximumTradeSizeLamports),
    maximumAggregateExposureLamports: sol("STRYKE_MAXIMUM_AGGREGATE_EXPOSURE_SOL", referenceBotDefaults.maximumAggregateExposureLamports),
    minimumEntryEdgeBps: numberEnv(env, "STRYKE_MINIMUM_ENTRY_EDGE_BPS", referenceBotDefaults.minimumEntryEdgeBps),
    maximumPriceImpactBps: numberEnv(env, "STRYKE_MAXIMUM_PRICE_IMPACT_BPS", referenceBotDefaults.maximumPriceImpactBps),
    minimumSecondsToExpiry: numberEnv(env, "STRYKE_MINIMUM_SECONDS_TO_EXPIRY", referenceBotDefaults.minimumSecondsToExpiry),
    maximumOpenPositions: numberEnv(env, "STRYKE_MAXIMUM_OPEN_POSITIONS", referenceBotDefaults.maximumOpenPositions),
    tickIntervalMs: numberEnv(env, "STRYKE_TICK_INTERVAL_MS", referenceBotDefaults.tickIntervalMs),
    stopLossBps: numberEnv(env, "STRYKE_STOP_LOSS_BPS", referenceBotDefaults.stopLossBps),
    takeProfitBps: numberEnv(env, "STRYKE_TAKE_PROFIT_BPS", referenceBotDefaults.takeProfitBps),
    priceHistoryMaxPoints: numberEnv(env, "STRYKE_PRICE_HISTORY_MAX_POINTS", referenceBotDefaults.priceHistoryMaxPoints),
    readOnlyMode, liveTradingEnabled, killSwitchEnabled,
    checkpointPath: env.STRYKE_CHECKPOINT_PATH ?? referenceBotDefaults.checkpointPath,
    ...(env.STRYKE_API_BASE_URL ? { apiBaseUrl: env.STRYKE_API_BASE_URL } : {}),
    ...(env.STRYKE_SOLANA_RPC_URL ? { solanaRpcUrl: env.STRYKE_SOLANA_RPC_URL } : {}),
    ...(env.STRYKE_WALLET_ADAPTER_PATH ? { walletAdapterPath: env.STRYKE_WALLET_ADAPTER_PATH } : {}),
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
