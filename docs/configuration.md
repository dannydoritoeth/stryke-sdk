# Configuration

Read-only mode has educational defaults. Active live mode requires every
trading/risk control explicitly; missing or invalid input fails before wallet or
transaction work.

| Environment variable | Unit / values |
| --- | --- |
| `STRYKE_ASSET` | `BTC`, `SOL` |
| `STRYKE_EXPIRY_FAMILY` | `one_minute`, `five_minute`, `fifteen_minute`, `hourly` |
| `STRYKE_SIDE` | `yes`, `no` |
| `STRYKE_ESTIMATOR` | `distance_to_strike`, `distance_momentum` |
| `STRYKE_TRADE_SIZE_SOL` | positive decimal, maximum 9 decimals |
| `STRYKE_MAXIMUM_TRADE_SIZE_SOL` | positive decimal; ≥ trade size |
| `STRYKE_MAXIMUM_AGGREGATE_EXPOSURE_SOL` | positive decimal; ≥ trade cap |
| `STRYKE_MINIMUM_ENTRY_EDGE_BPS` | integer `0..10000` |
| `STRYKE_MAXIMUM_PRICE_IMPACT_BPS` | integer `0..9999` |
| `STRYKE_MINIMUM_SECONDS_TO_EXPIRY` | non-negative integer seconds |
| `STRYKE_MAXIMUM_OPEN_POSITIONS` | positive integer |
| `STRYKE_TICK_INTERVAL_MS` | integer ≥ `1000` |
| `STRYKE_STOP_LOSS_BPS` | integer `1..10000`; equality exits |
| `STRYKE_TAKE_PROFIT_BPS` | positive integer; equality exits |
| `STRYKE_PRICE_HISTORY_MAX_POINTS` | integer `2..10000` |

Mode and connection controls are `STRYKE_READ_ONLY_MODE`,
`STRYKE_LIVE_TRADING_ENABLED`, `STRYKE_KILL_SWITCH_ENABLED`,
`STRYKE_API_BASE_URL`, `STRYKE_SOLANA_RPC_URL`,
`STRYKE_WALLET_ADAPTER_PATH`, and `STRYKE_CHECKPOINT_PATH`. Booleans are exactly
`true` or `false`. Read-only and the kill switch override live enablement. The
checkpoint defaults to `.stryke/reference-bot-action.json`.
`STRYKE_PYTH_HERMES_URL` may select the supplied Hermes endpoint; otherwise the
public endpoint is used.

In the typed config, `readOnlyMode` Overrides live enablement and
`killSwitchEnabled` Overrides live enablement. The environment variables above
map directly to those controls.

SOL values convert once to exact lamports. Quotes, shares, proceeds, cost basis,
and payout math stay in integer base units. The wallet module default-exports an
`@solana/kit` `TransactionSigner`; inline keys, seed phrases, mnemonics, signed
transactions, and wallet material are rejected or redacted.
