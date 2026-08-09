import { StrykeSdkError } from "@stryketrade/sdk";

import type { ReferenceBotConfig } from "./config.js";

export const PILOT_WALLET_GUIDANCE =
  "Use a separately funded, minimally funded pilot wallet through a wallet adapter path.";

export const loadWalletForLiveTrading = async <T>(
  config: ReferenceBotConfig,
  loader: (adapterPath: string) => Promise<T>
): Promise<T | undefined> => {
  if (config.readOnlyMode || !config.liveTradingEnabled || config.killSwitchEnabled) return undefined;
  if (!config.walletAdapterPath) {
    throw new StrykeSdkError("configuration", "Live trading requires a wallet adapter path");
  }
  return loader(config.walletAdapterPath);
};
