# Configuration

Copy `.env.example` to `.env`. It contains the complete minimum-size educational
baseline. `start:paper`, `start:devnet`, and `start:live` select the safety
profile; missing or invalid input fails before wallet or transaction work.

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

Connection controls are `STRYKE_API_BASE_URL`, `STRYKE_SOLANA_RPC_URL`,
`STRYKE_WALLET_ADAPTER_PATH`, and `STRYKE_CHECKPOINT_PATH`. Booleans are exactly
`true` or `false` when used by custom integrations. The public commands force
safe mode precedence: paper is read-only, devnet enables signed devnet actions,
and live fails closed pending mainnet approval. The checkpoint defaults to
`.stryke/reference-bot-action.json`.
`STRYKE_PYTH_HERMES_URL` may select the supplied Hermes endpoint; otherwise the
public endpoint is used. It is validated with the rest of the typed config and
printed in the non-secret effective configuration.

The bundled example wallet adapter reads `STRYKE_WALLET_KEYPAIR_PATH`. Point it
to an absolute path outside the repository for a separately funded devnet
keypair, or use the quickstart's `../stryke-devnet-wallet.json` path. Generate
that dedicated wallet with `solana-keygen new`; its JSON file contains private
key material and must not be committed or shared. The key bytes are never
copied into `.env` or logs.

In the typed config, `readOnlyMode` Overrides live enablement and
`killSwitchEnabled` Overrides live enablement.

SOL values convert once to exact lamports. Quotes, shares, proceeds, cost basis,
and payout math stay in integer base units. The wallet module default-exports an
`@solana/kit` `TransactionSigner`; inline keys, seed phrases, mnemonics, signed
transactions, and wallet material are rejected or redacted.

Maintainers can run `npm run check:config-controls` to verify every documented
control still has a named final runtime consumer and exact test evidence.
