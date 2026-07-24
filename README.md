# Stryke SDK Pilot

Private TypeScript SDK and reference bot for invited developers trading Stryke
BTC/SOL devnet markets. This is educational software, not investment advice;
outcomes are not guaranteed. Node.js 22+ is required.

The SDK supplies typed markets, Pyth prices/history, executable quotes, reviewed
transactions, restart-safe reconciliation, positions, sells, claims, and
refunds. The reference bot continuously reconciles → manages/exits → settles →
evaluates the next market. It includes two transparent educational estimators.

## Start safely

```bash
npm ci
npm run start:read-only -w @stryke/reference-bot
```

That deterministic fixture needs no endpoint or wallet. For one real SDK
evaluation tick with no wallet or submission:

```bash
STRYKE_READ_ONLY_MODE=true STRYKE_ASSET=BTC \
STRYKE_EXPIRY_FAMILY=five_minute STRYKE_SIDE=yes \
STRYKE_ESTIMATOR=distance_to_strike \
STRYKE_API_BASE_URL="$INVITED_DEVNET_API" \
npm run start:live-data -w @stryke/reference-bot -- --once
```

Remove `--once` to observe continuously; optionally set
`STRYKE_ESTIMATOR=distance_momentum` and `STRYKE_TICK_INTERVAL_MS=5000`.
Both bundled strategies are simple baselines. Replace only the exported
`estimateFairProbability` seam in `examples/reference-bot/src/strategy.ts` for
your own signal.

Every run prints effective non-secret config and each waiting, blocked, hold,
entry, exit, claim, or refund reason.

## Minimum-size devnet live example

Live trading defaults off. Use a separately funded, minimally funded devnet
wallet adapter. Copy `.env.example`, set every value explicitly, then deliberately
change the three mode gates and run:

```bash
STRYKE_READ_ONLY_MODE=false STRYKE_LIVE_TRADING_ENABLED=true \
STRYKE_KILL_SWITCH_ENABLED=false STRYKE_ASSET=BTC \
STRYKE_EXPIRY_FAMILY=five_minute STRYKE_SIDE=yes \
STRYKE_ESTIMATOR=distance_to_strike STRYKE_TRADE_SIZE_SOL=0.001 \
STRYKE_MAXIMUM_TRADE_SIZE_SOL=0.001 \
STRYKE_MAXIMUM_AGGREGATE_EXPOSURE_SOL=0.001 \
STRYKE_MINIMUM_ENTRY_EDGE_BPS=0 STRYKE_MAXIMUM_PRICE_IMPACT_BPS=100 \
STRYKE_MINIMUM_SECONDS_TO_EXPIRY=60 STRYKE_MAXIMUM_OPEN_POSITIONS=1 \
STRYKE_TICK_INTERVAL_MS=5000 STRYKE_STOP_LOSS_BPS=1000 \
STRYKE_TAKE_PROFIT_BPS=2000 STRYKE_PRICE_HISTORY_MAX_POINTS=120 \
STRYKE_API_BASE_URL="$INVITED_DEVNET_API" \
STRYKE_SOLANA_RPC_URL="$DEVNET_RPC_URL" \
STRYKE_WALLET_ADAPTER_PATH=./wallet-adapter.js \
npm run start:live -w @stryke/reference-bot
```

This does not force a trade. Entry happens only when the selected estimator and
every freshness, edge, impact, time, exposure, checkpoint, wallet, and mode gate
pass. The loop uses full-position executable sell quotes, applies the configured
10% stop loss / 20% take profit before its EV fallback, waits for
API-authoritative resolution, claims/refunds, reconciles, and repeats.

Never put a seed phrase, private key, secret key, or signed transaction in config
or logs. See the [quickstart](docs/quickstart.md),
[configuration](docs/configuration.md), [market mechanics](docs/market-mechanics.md),
and [error recovery](docs/troubleshooting.md).
