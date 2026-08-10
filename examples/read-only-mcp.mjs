import { StrykeMcpToolError, StrykeReadOnlyMcpClient } from "@stryketrade/sdk";

const client = await StrykeReadOnlyMcpClient.connect({
  endpoint: process.env.STRYKE_MCP_URL,
  clientName: "stryke-read-only-example",
});

try {
  const environment = await client.getEnvironment();
  const current = await client.getCurrentPythMarkets({ symbol: "BTC", state: "tradable" });
  const marketId = current.markets[0]?.marketId;
  if (!marketId) {
    console.log(JSON.stringify({ environment, message: "No current BTC market; retry later." }, null, 2));
    process.exitCode = 0;
  } else {
    const market = await client.getMarket(marketId);
    const quote = await client.previewQuote({
      marketId,
      action: "buy",
      side: "up",
      amount: { value: "0.01", unit: "SOL" },
    });
    console.log(JSON.stringify({ environment, market, quote }, null, 2));
  }
} catch (error) {
  if (error instanceof StrykeMcpToolError) {
    console.error(JSON.stringify({ code: error.code, message: error.message, retryable: error.retryable, retryAfterMs: error.retryAfterMs, remediation: error.remediation }));
  }
  throw error;
} finally {
  await client.close();
}
