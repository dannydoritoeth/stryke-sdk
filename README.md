# Stryke SDK Pilot

Private invited-developer pilot for building TypeScript bots against Stryke's
BTC and SOL markets.

The repository contains the typed SDK and a small reference-bot package. The
SDK covers market reads, Pyth freshness, executable quotes, reviewed
buy/sell/claim/refund preparation, wallet-local execution seams, durable action
reconciliation, and authoritative position lifecycle parsing. Five-minute BTC
is the canonical onboarding path. The SDK also targets BTC and SOL 1m, 5m,
15m, and 1h markets; 1m live strategy performance is experimental.

```bash
npm ci
npm run build
npm test
```

Live trading is off by default. Use a separately funded devnet wallet and never
place a seed phrase or raw private key in environment variables.

See [the quickstart](docs/quickstart.md) and
[market mechanics](docs/market-mechanics.md).
