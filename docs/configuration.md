# Configuration

Copy `.env.example` to `.env`. It contains the complete minimum-size recommended
baseline. `start:paper`, `start:devnet`, and `start:live` select the safety
profile; missing or invalid input fails before wallet or transaction work.

| Environment variable | Unit / values |
| --- | --- |
| `STRYKE_ASSET` | `BTC`, `SOL` |
| `STRYKE_EXPIRY_FAMILY` | `one_minute`, `five_minute`, `fifteen_minute`, `hourly` |
| `STRYKE_STRATEGY` | `polymarket_early` (example default), `polymarket_late`, or `baseline` |
| `STRYKE_ESTIMATOR` | Baseline model: `volatility_adjusted_probability` (default), `distance_to_strike`, or `distance_momentum`; ignored by Polymarket strategies |
| `STRYKE_TRADE_SIZE_SOL` | positive decimal, maximum 9 decimals |
| `STRYKE_MAXIMUM_TRADE_SIZE_SOL` | positive decimal; ≥ trade size |
| `STRYKE_MAXIMUM_AGGREGATE_EXPOSURE_SOL` | positive decimal; ≥ trade cap |
| `STRYKE_MINIMUM_ENTRY_EDGE_BPS` | integer `0..10000` |
| `STRYKE_MAXIMUM_PRICE_IMPACT_BPS` | integer `0..9999` |
| `STRYKE_MINIMUM_SECONDS_TO_EXPIRY` | non-negative integer seconds |
| `STRYKE_MAXIMUM_OPEN_POSITIONS` | integer `1..100`; default `3` so unresolved consecutive rounds may overlap |
| `STRYKE_TICK_INTERVAL_MS` | integer ≥ `1000` |
| `STRYKE_STOP_LOSS_BPS` | integer `1..10000`; equality exits |
| `STRYKE_TAKE_PROFIT_BPS` | positive integer; equality exits |
| `STRYKE_PRICE_HISTORY_MAX_POINTS` | integer `2..100000`; storage cap, not the time window |
| `STRYKE_HISTORY_LOOKBACK_SECONDS_1M` | `60..300` |
| `STRYKE_HISTORY_LOOKBACK_SECONDS_5M` | `300..1200` |
| `STRYKE_HISTORY_LOOKBACK_SECONDS_15M` | `900..3600` |
| `STRYKE_HISTORY_LOOKBACK_SECONDS_1H` | `3600..21600` |
| `STRYKE_MINIMUM_HISTORY_COVERAGE_BPS` | `1..10000`; default `8000` |
| `STRYKE_MINIMUM_VOLATILITY_BPS_PER_SQRT_HOUR` | positive integer lower bound |
| `STRYKE_MAXIMUM_VOLATILITY_BPS_PER_SQRT_HOUR` | integer at or above the lower bound |
| `STRYKE_MAXIMUM_MODEL_PROBABILITY_BPS` | `5001..9999`; complementary lower clamp is `10000 - value` |
| `STRYKE_FEE_FREE_ACTIVATION_LIMIT_SOL` | positive SOL amount; expected protocol region, default `10` |
| `STRYKE_FEE_FREE_BUFFER_SOL` | non-negative SOL amount below the activation limit, default `0.5` |
| `STRYKE_POLY_ENTRY_EDGE_BPS` | absolute probability difference `1..10000`, default `500` |
| `STRYKE_POLY_EXIT_EDGE_BPS` | non-negative and lower than entry edge, default `200` |
| `STRYKE_POLY_MAX_SPREAD_BPS` | maximum executable Polymarket spread, default `1000` |
| `STRYKE_POLY_MAX_PRICE_AGE_MS` | positive book freshness limit, default `5000` |
| `STRYKE_POLY_TIMEOUT_MS` | positive request timeout up to 30000, default `3000` |
| `STRYKE_POLY_EARLY_WINDOW_SECONDS` | seconds after interval start in which early entry is allowed, default `60` |
| `STRYKE_POLY_LATE_WINDOW_SECONDS` | seconds before closing-fee onset at which late evaluation begins, default `20` |
| `STRYKE_POLY_SUBMISSION_BUFFER_SECONDS` | no-entry buffer before closing-fee onset, default `3`; lower than late window |
| `STRYKE_POLY_MIN_HOLD_RETURN_BPS` | minimum Polymarket-weighted expected hold return, default `100` |
| `STRYKE_POLY_MIN_WIN_PROFIT_BPS` | minimum profit if the selected side wins, default `100` |
| `STRYKE_POLY_BOOTSTRAP_EMPTY_MARKET` | allow a minimum-size first trade when both real pools are exactly empty and the Polymarket edge passes; default `true` |
| `STRYKE_POLY_EXIT_POLICY` | `hold_to_expiry`, `exit_on_convergence` (default), or `risk_managed`; late always holds |

Connection controls are `STRYKE_API_BASE_URL`, `STRYKE_SOLANA_RPC_URL`,
`STRYKE_WALLET_ADAPTER_PATH`, `STRYKE_CHECKPOINT_PATH`, and
`STRYKE_ROUND_STATE_PATH`. The default `STRYKE_STATE_BACKEND=file` needs no
database and uses those two local paths. Operators who need multiple-host
restart safety can select `STRYKE_STATE_BACKEND=postgres`, provide
`STRYKE_DATABASE_URL`, and set a stable `STRYKE_STATE_NAMESPACE`. The public
Postgres adapter then stores action checkpoints and round decisions and holds
one renewable lease for the cluster, wallet, asset, and expiry family.
`STRYKE_LEASE_TTL_MS` defaults to `30000` and accepts 5000–300000. A competing
bot or lost lease fails closed. The database URL is redacted from effective
configuration output. Booleans are exactly
`true` or `false` when used by custom integrations. The public commands force
safe mode precedence: paper is read-only, live enables signed mainnet actions,
and devnet remains available for compatible test deployments. The checkpoint defaults to
`.stryke/reference-bot-action.json`.
Confirmed convergence exits are stored separately in
`.stryke/reference-bot-rounds.json` so restart cannot re-enter the same round.
`STRYKE_PYTH_HERMES_URL` may select the supplied Hermes endpoint; otherwise the
public endpoint is used. It is validated with the rest of the typed config and
printed in the non-secret effective configuration.
`STRYKE_POLYMARKET_CLOB_URL` selects the public read-only CLOB endpoint.

The relative-value strategies require an `aligned` market reference. Entry
uses the quote's total debit and resulting Winning Payout—not the displayed
spot probability—to calculate the executable cost probability, expected hold
return and win profit. Early may use executable bids for convergence exit.
Native one-minute and degraded fallback rounds are skipped. The bot never
places Polymarket orders and this is not an arbitrage guarantee.

The bundled example wallet adapter reads `STRYKE_WALLET_KEYPAIR_PATH`. Point it
to an absolute path outside the repository for a separately funded trading
keypair, or use the quickstart's `../stryke-trading-wallet.json` path. Generate
that dedicated wallet with `solana-keygen new`; its JSON file contains private
key material and must not be committed or shared. The key bytes are never
copied into `.env` or logs.

Realised volatility is measured in basis points per square-root hour. History
coverage is elapsed time, not observation count. Invalid, unordered, stale or
insufficient history blocks the decision; the bot never substitutes an
educational estimator. Both sides use the same proposed size and market-state
version. Sizing is capped by configured trade/exposure limits and the remaining
real-pool activation capacity after the buffer. Virtual liquidity is never
activation capacity. Quote-authored fee mode and closing protection remain
authoritative; activated, closing, locked or incoherent quotes block entry.

In the typed config, `readOnlyMode` Overrides live enablement and
`killSwitchEnabled` Overrides live enablement.

SOL values convert once to exact lamports. Quotes, shares, proceeds, cost basis,
and payout math stay in integer base units. The wallet module default-exports an
`@solana/kit` `TransactionSigner`; inline keys, seed phrases, mnemonics, signed
transactions, and wallet material are rejected or redacted.

Maintainers can run `npm run check:config-controls` to verify every documented
control still has a named final runtime consumer and exact test evidence.
