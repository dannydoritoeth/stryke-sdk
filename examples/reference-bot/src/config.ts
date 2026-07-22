import { StrykeSdkError } from "@stryke/sdk";

export type ReferenceBotConfig = {
  maximumTradeSizeSol: number;
  maximumAggregateExposureSol: number;
  minimumEntryEdgeBps: number;
  maximumPriceImpactBps: number;
  minimumSecondsToExpiry: number;
  maximumOpenPositions: number;
  readOnlyMode: boolean;
  liveTradingEnabled: boolean;
  killSwitchEnabled: boolean;
  walletAdapterPath?: string;
};

export const referenceBotDefaults: ReferenceBotConfig = {
  maximumTradeSizeSol: 0.01,
  maximumAggregateExposureSol: 0.05,
  minimumEntryEdgeBps: 200,
  maximumPriceImpactBps: 100,
  minimumSecondsToExpiry: 60,
  maximumOpenPositions: 3,
  readOnlyMode: true,
  liveTradingEnabled: false,
  killSwitchEnabled: true,
};

const finite = (value: unknown, name: string, minimum: number, maximum: number) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new StrykeSdkError("configuration", `Invalid reference bot config: ${name}`);
  }
  return value;
};

export const parseReferenceBotConfig = (
  input: Partial<ReferenceBotConfig> & Record<string, unknown>
): ReferenceBotConfig => {
  for (const forbidden of ["privateKey", "seedPhrase", "mnemonic", "secretKey"]) {
    if (input[forbidden] !== undefined) {
      throw new StrykeSdkError("configuration", "Inline wallet secrets are not supported");
    }
  }
  const config = { ...referenceBotDefaults, ...input } as ReferenceBotConfig;
  for (const key of ["readOnlyMode", "liveTradingEnabled", "killSwitchEnabled"] as const) {
    if (typeof config[key] !== "boolean") {
      throw new StrykeSdkError("configuration", `Invalid reference bot config: ${key}`);
    }
  }
  config.maximumTradeSizeSol = finite(config.maximumTradeSizeSol, "maximumTradeSizeSol", Number.EPSILON, Number.MAX_SAFE_INTEGER);
  config.maximumAggregateExposureSol = finite(config.maximumAggregateExposureSol, "maximumAggregateExposureSol", Number.EPSILON, Number.MAX_SAFE_INTEGER);
  config.minimumEntryEdgeBps = finite(config.minimumEntryEdgeBps, "minimumEntryEdgeBps", 0, 10_000);
  config.maximumPriceImpactBps = finite(config.maximumPriceImpactBps, "maximumPriceImpactBps", 0, 10_000);
  config.minimumSecondsToExpiry = finite(config.minimumSecondsToExpiry, "minimumSecondsToExpiry", 0, Number.MAX_SAFE_INTEGER);
  config.maximumOpenPositions = finite(config.maximumOpenPositions, "maximumOpenPositions", 1, Number.MAX_SAFE_INTEGER);
  if (!Number.isInteger(config.minimumSecondsToExpiry) || !Number.isInteger(config.maximumOpenPositions)) {
    throw new StrykeSdkError("configuration", "Time and position limits must be integers");
  }
  if (config.maximumAggregateExposureSol < config.maximumTradeSizeSol) {
    throw new StrykeSdkError("configuration", "Aggregate exposure must cover the per-trade cap");
  }
  if (config.walletAdapterPath !== undefined && (typeof config.walletAdapterPath !== "string" || !config.walletAdapterPath)) {
    throw new StrykeSdkError("configuration", "Wallet adapter path is invalid");
  }
  return config;
};
