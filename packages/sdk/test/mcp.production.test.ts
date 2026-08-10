import { describe, expect, it } from "vitest";

import { STRYKE_MCP_TOOL_NAMES, StrykeReadOnlyMcpClient } from "../src/index.js";

const production = process.env.STRYKE_MCP_PRODUCTION === "1" ? describe : describe.skip;

production("production read-only MCP", () => {
  it("runs the public four-step consumer flow", async () => {
    const client = await StrykeReadOnlyMcpClient.connect({ clientName: "stryke-sdk-production-test" });
    try {
      const environment = await client.getEnvironment();
      expect(environment).toMatchObject({ anonymous: true, readOnly: true, toolCount: STRYKE_MCP_TOOL_NAMES.length });
      const current = await client.getCurrentPythMarkets({ symbol: "BTC", state: "tradable" });
      const marketId = current.markets[0]?.marketId;
      if (!marketId) return;
      const detail = await client.getMarket(marketId);
      expect(detail.market.marketId).toBe(marketId);
      const quote = await client.previewQuote({ marketId, action: "buy", side: "up", amount: { value: "0.01", unit: "SOL" } });
      expect(quote).toMatchObject({ marketId, action: "buy", side: "up", input: { value: "0.01", unit: "SOL" } });
    } finally {
      await client.close();
    }
  }, 30_000);
});
