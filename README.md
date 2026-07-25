# Stryke SDK Pilot

Private TypeScript SDK and reference bot for invited developers trading Stryke
BTC/SOL devnet markets. This is educational software, not investment advice;
outcomes are not guaranteed. Node.js 22+ is required.

The SDK supplies typed markets, Pyth prices/history, executable quotes, reviewed
transactions, restart-safe reconciliation, positions, sells, claims, and
refunds. The reference bot continuously reconciles → manages/exits → settles →
evaluates the next market. It includes two transparent educational estimators.

## Three-step confidence ladder

```bash
npm ci
cp .env.example .env
npm run start:paper -w @stryke/reference-bot
```

Open `.env` to inspect the minimum-size strategy and risk settings. Replace the
invited devnet API value before using real data. Paper mode reads real markets,
Pyth prices, and quotes but never loads a wallet or submits a transaction.

```bash
npm run start:devnet -w @stryke/reference-bot
```

Devnet mode uses the same `.env` values and a separately funded wallet adapter
to make minimum-size signed devnet trades when the estimator and every safety
gate pass. It continuously manages positions, exits or waits for expiry,
claims/refunds, reconciles, and repeats.

Before the first devnet run, follow the [quickstart wallet steps](docs/quickstart.md#2-create-and-fund-a-dedicated-devnet-wallet) to create a dedicated keypair, fund its public address, and set its file path in `.env`.

```bash
npm run start:live -w @stryke/reference-bot
```

`start:live` is the eventual mainnet command. It currently fails closed before
wallet loading because this pilot is devnet-only and mainnet requires separate
approval and compatible API/program deployment.

Both bundled estimators are simple educational baselines. Replace only the
exported `estimateFairProbability` seam in
`examples/reference-bot/src/strategy.ts` for your own signal. Every run prints
effective non-secret config and each waiting, blocked, hold, entry, exit, claim,
or refund reason. No command forces a trade.

Never put a seed phrase, private key, secret key, or signed transaction in config
or logs. See the [quickstart](docs/quickstart.md),
[configuration](docs/configuration.md), [market mechanics](docs/market-mechanics.md),
and [error recovery](docs/troubleshooting.md).
