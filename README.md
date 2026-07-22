# Stryke SDK Pilot

Private invited-developer pilot for TypeScript bots trading Stryke BTC and SOL
markets. It is educational software, not investment advice; outcomes are not
guaranteed. The package is consumed from this repository during the pilot and
is not published to npm.

The SDK owns API compatibility, exact market reads, Pyth freshness, executable
quotes, reviewed transaction preparation, wallet-local execution seams,
restart-safe reconciliation, and authoritative position actions. The small
reference bot owns only one estimator and visible trading decisions.

## Start read-only

Node.js 22 or newer is required. This copyable smoke uses a documented BTC
five-minute fixture, prints the active SDK/API/program compatibility contract,
and never loads a wallet or submits a transaction.

```bash
npm ci
npm run start:read-only -w @stryke/reference-bot
```

Replace only `examples/reference-bot/src/strategy.ts` to supply your estimator,
then rerun the command. One-minute markets are SDK-supported, but live strategy
performance is experimental; BTC five-minute is the canonical onboarding path.

## Live gate

Live trading defaults off. Use only a separately funded, minimally funded
devnet pilot wallet through a wallet-adapter module. Never put a seed phrase,
private key, secret key, or signed transaction in configuration or logs.

The following command intentionally fails until every gate is explicit and a
valid wallet-adapter path exists:

```bash
STRYKE_READ_ONLY_MODE=false \
STRYKE_LIVE_TRADING_ENABLED=true \
STRYKE_KILL_SWITCH_ENABLED=false \
STRYKE_WALLET_ADAPTER_PATH=./wallet-adapter.js \
npm run start:live -w @stryke/reference-bot
```

Passing the startup gate does not itself place a trade. Reviewed transactions
still require a fresh exact-market quote, successful simulation, wallet-local
approval, submission, confirmation, and authoritative reconciliation.

Read the [quickstart](docs/quickstart.md),
[market mechanics](docs/market-mechanics.md),
[configuration reference](docs/configuration.md), and
[typed-error recovery guide](docs/troubleshooting.md). Maintainers can inspect
the latest [docs-only rehearsal](docs/maintainer-rehearsal.md).
