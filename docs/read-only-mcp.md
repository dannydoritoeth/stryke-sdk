# Read-only MCP

Stryke's anonymous MCP endpoint provides market discovery, market detail, and
quote previews without a wallet or credentials. It cannot prepare, sign,
submit, claim, refund, close, trade, or forward arbitrary API or RPC calls.

The SDK uses the official MCP Streamable HTTP client and fails closed unless
the server exposes exactly the four documented Phase A tools with read-only
annotations:

- `stryke_get_environment`
- `stryke_get_current_pyth_markets`
- `stryke_get_market`
- `stryke_preview_quote`

## Run the reference flow

From a source checkout:

```bash
npm ci
npm run example:mcp
```

From an installed package:

```js
import { StrykeMcpToolError, StrykeReadOnlyMcpClient } from "@stryketrade/sdk";

const client = await StrykeReadOnlyMcpClient.connect();
try {
  const environment = await client.getEnvironment();
  const current = await client.getCurrentPythMarkets({
    symbol: "BTC",
    state: "tradable",
  });
  const marketId = current.markets[0]?.marketId;
  if (!marketId) {
    console.log("No current BTC market; retry later.");
  } else {
    const market = await client.getMarket(marketId);
    const quote = await client.previewQuote({
      marketId,
      action: "buy",
      side: "up",
      amount: { value: "0.01", unit: "SOL" },
    });
    console.log({ environment, market, quote });
  }
} catch (error) {
  if (error instanceof StrykeMcpToolError) {
    console.error(error.code, error.retryable, error.retryAfterMs);
  }
  throw error;
} finally {
  await client.close();
}
```

Always discover `marketId` dynamically. Preserve decimal strings and their
units: buys use `SOL`; sells use `shares`. A healthy empty market list is not a
request failure.

`StrykeMcpToolError` preserves the server's structured `code`, `retryable`,
optional `retryAfterMs`, and optional `remediation`. Retry only when
`retryable` is true, bound the number of attempts, and honor `retryAfterMs`.
Do not silently change the symbol,
source, collateral, network, endpoint, or requested market.

The production endpoint defaults to `https://api.stryketrade.com/mcp`. An
explicit `endpoint` option is available for controlled tests; the client never
falls back to another origin. It sends no API key, wallet, OAuth token, or
cookie.

## Validate production

The opt-in integration test follows the complete ordered consumer flow against
production and treats an empty current-market result as healthy:

```bash
npm run test:mcp:production
```

The canonical server-neutral contract is the published
[MCP integration bundle](https://stryketrade.com/api-docs/mcp-sdk/), including
its [tool contracts](https://stryketrade.com/api-docs/mcp-sdk/tools.json),
[compatibility metadata](https://stryketrade.com/api-docs/mcp-sdk/compatibility.json),
and [checksummed manifest](https://stryketrade.com/api-docs/mcp-sdk/manifest.json).
