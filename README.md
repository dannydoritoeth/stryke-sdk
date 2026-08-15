# Stryke SDK

TypeScript SDK and reference bot for Stryke BTC/SOL prediction markets. Node.js
22+ is required. This is educational software, not investment advice.

## Start paper trading

From an empty directory:

```bash
npm init -y
npm install @stryketrade/sdk @stryketrade/reference-bot
npx stryke-reference-bot doctor --profile=paper
npx stryke-reference-bot --profile=paper
```

Paper mode uses live production markets and executable quotes, but never loads
a wallet or submits a transaction. It also consumes Pyth observations to settle
simulated positions. Stop it with Ctrl-C. For a short check, add `--ticks=2`.

Doctor exits with:

- `READY_FOR_PAPER`: start the bot;
- `WAITING_FOR_MARKET`: setup is healthy, but no eligible market is currently
  available; or
- `BLOCKED`: follow the printed remediation.

## Move to live trading

Create a dedicated wallet outside the project:

```bash
solana-keygen new --outfile ../stryke-trading-wallet.json
solana-keygen pubkey ../stryke-trading-wallet.json
```

Fund only the printed address. The keypair file controls the wallet: never
commit or share it, and do not use a personal wallet.

Point the installed bot at its bundled wallet adapter and your keypair:

```bash
export STRYKE_WALLET_ADAPTER_PATH="$PWD/node_modules/@stryketrade/reference-bot/wallet-adapter.example.mjs"
export STRYKE_WALLET_KEYPAIR_PATH="$PWD/../stryke-trading-wallet.json"
```

Check readiness without signing, then explicitly start live trading:

```bash
npx stryke-reference-bot doctor --profile=live
npx stryke-reference-bot --profile=live
```

Live mode uses the same market selection, strategy, minimum-size configuration,
and safety checks as paper mode. A trade occurs only when every gate passes.
The bot continuously reconciles saved actions, manages open positions, sells or
waits for settlement, claims/refunds, recovers eligible position-account rent,
and then evaluates the next market. If the wallet lacks the new-entry reserve,
existing lifecycle recovery continues while new entries remain blocked.

The configured default is checked against the API-authoritative on-chain
minimum for every market. A first trade may also pay one-time shared market
initialization costs, so fund more than the quoted trade amount and review the
doctor's required balance.

## How decisions work

The default `polymarket_early` and optional `polymarket_late` strategies use the
Stryke API's current market and aligned Polymarket reference identifiers. They
compare fresh Stryke executable buy quotes with fresh Polymarket executable
asks, then apply the configured timing, edge, exposure, minimum-size, slippage,
and fee-free-capacity gates. Live Polymarket strategies do not open a Pyth
stream and do not use Pyth for entry decisions.

`polymarket_early` may sell when the remaining Polymarket edge converges,
subject to its exit policy. `polymarket_late` can revalidate shortly before
closing fees rise: it repeats the same executable Stryke-versus-Polymarket
economics at the position's original cost basis. It holds only when the best
qualifying side is still the held side; otherwise it sells. If required data is
temporarily unavailable, it retries inside the bounded revalidation window and
holds when that window expires without a safe decision.

The `baseline` strategy is different: its probability model uses fresh Pyth
price and history, so missing or stale Pyth data correctly blocks that strategy.
Paper mode also retains Pyth for simulated settlement. Claims, refunds, and
position-account cleanup never use a private price opinion; they follow the
API-authored lifecycle and reviewed transaction plan.

## What is included

- `@stryketrade/sdk`: typed markets, Pyth prices/history, executable quotes,
  reviewed transactions, positions, sells, claims, refunds, cleanup, and
  restart-safe reconciliation.
- `@stryketrade/reference-bot`: a small continuous paper/live composition built
  only on the public SDK.

## Anonymous read-only MCP

Use the production MCP to inspect the environment, discover current BTC/SOL
markets, inspect one dynamically selected market, and preview a quote without
credentials or a wallet:

```js
import { StrykeReadOnlyMcpClient } from "@stryketrade/sdk";

const mcp = await StrykeReadOnlyMcpClient.connect();
try {
  const current = await mcp.getCurrentPythMarkets({ symbol: "BTC" });
  const marketId = current.markets[0]?.marketId;
  if (marketId) {
    console.log(await mcp.previewQuote({
      marketId,
      action: "buy",
      side: "up",
      amount: { value: "0.01", unit: "SOL" },
    }));
  }
} finally {
  await mcp.close();
}
```

The client rejects changed or non-read-only tool surfaces. See the
[read-only MCP guide](docs/read-only-mcp.md) for the complete reference flow,
structured error handling, and production validation command.

No included estimator guarantees accuracy or profit. Missing, stale, degraded,
or incompatible data fails closed. A signature proves submission, not
confirmation; the bot reconciles authoritative state before another action.

See the [quickstart](docs/quickstart.md), [configuration](docs/configuration.md),
[market mechanics](docs/market-mechanics.md), and
[troubleshooting](docs/troubleshooting.md).

## Source checkout

```bash
npm ci
npm run build
npm test
npm run start:paper -w @stryketrade/reference-bot
```

Devnet and live source commands are `npm run start:devnet -w
@stryketrade/reference-bot` and `npm run start:live -w
@stryketrade/reference-bot`. Mainnet execution remains protected by every
configured safety gate.
