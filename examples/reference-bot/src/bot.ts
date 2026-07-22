import { StrykeClient } from "@stryke/sdk";

import { referenceBotDefaults } from "./config.js";
import { decideEntry } from "./entry.js";
import { emitDecision } from "./logging.js";
import { decideOpenPosition, manageTerminalPosition } from "./manage-position.js";
import { estimateFairProbability } from "./strategy.js";
import { loadWalletForLiveTrading } from "./wallet.js";

export const referenceBot = {
  StrykeClient,
  config: referenceBotDefaults,
  estimateFairProbability,
  decideEntry,
  decideOpenPosition,
  manageTerminalPosition,
  loadWalletForLiveTrading,
  emitDecision,
};

export * from "./config.js";
export * from "./entry.js";
export * from "./logging.js";
export * from "./manage-position.js";
export * from "./strategy.js";
export * from "./wallet.js";
