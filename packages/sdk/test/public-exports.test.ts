import { describe, expect, it } from "vitest";

import * as sdk from "../src/index.js";

describe("public SDK exports", () => {
  it("exports only the documented compatibility foundation", () => {
    expect(Object.keys(sdk).sort()).toEqual([
      "FileActionCheckpointStore",
      "MarketsClient",
      "MemoryActionCheckpointStore",
      "PILOT_ASSETS",
      "PILOT_EXPIRY_FAMILIES",
      "PILOT_MARKET_LIFECYCLE_STATES",
      "PILOT_POSITION_LIFECYCLE_STATES",
      "PYTH_FEED_IDS",
      "PositionsClient",
      "PriceStore",
      "QuotesClient",
      "ReviewedTransactionExecutor",
      "SDK_VERSION",
      "STRYKE_SDK_ERROR_CODES",
      "SUPPORTED_API_SCHEMA_VERSION",
      "SUPPORTED_API_VERSION",
      "SUPPORTED_PROGRAM_ID",
      "SUPPORTED_PROGRAM_VERSION",
      "SolanaReviewedExecutionAdapter",
      "StrykeClient",
      "StrykeSdkError",
      "TransactionsClient",
      "assertQuoteUsable",
      "createPilotIntentHash",
      "createTerminalIntentHash",
      "firstVerifiedExpiryCrossingObservation",
      "parseCapabilitiesV1",
      "parseHermesUpdate",
      "parsePilotMarket",
      "parsePilotMarketLifecycle",
      "parsePilotPosition",
      "parsePilotPositionLifecycle",
      "settlementOutcome",
      "subscribeHermes",
      "terminalActionFor",
    ]);
  });

  it("keeps runtime and strategy implementation out of the SDK entrypoint", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../src/index.ts", import.meta.url), "utf8")
    );
    expect(source).not.toMatch(/reference-bot|private-bot|strategy\.js|bot\.js/);
    expect(source).not.toContain("process.env");
  });
});
