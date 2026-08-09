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

Paper mode uses live production markets, Pyth data, and executable quotes. It
never loads a wallet or submits a transaction. Stop it with Ctrl-C. For a short
check, add `--ticks=2`.

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

## What is included

- `@stryketrade/sdk`: typed markets, Pyth prices/history, executable quotes,
  reviewed transactions, positions, sells, claims, refunds, cleanup, and
  restart-safe reconciliation.
- `@stryketrade/reference-bot`: a small continuous paper/live composition built
  only on the public SDK.

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
