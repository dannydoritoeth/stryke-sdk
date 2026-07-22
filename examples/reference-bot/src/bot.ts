import { StrykeClient } from "@stryke/sdk";

import { referenceBotDefaults } from "./config.js";
import { estimateFairProbability } from "./strategy.js";

export const referenceBot = {
  StrykeClient,
  config: referenceBotDefaults,
  estimateFairProbability,
};
