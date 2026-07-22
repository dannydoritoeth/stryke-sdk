# Configuration

All controls fail closed. Amount limits below are SOL-denominated numbers for
the reference pilot; SDK and API financial quantities remain exact integer
strings in their documented collateral units.

| Control | Default | Rule |
| --- | ---: | --- |
| `maximumTradeSizeSol` | `0.01` | Positive; each entry must not exceed it |
| `maximumAggregateExposureSol` | `0.05` | Must cover the per-trade cap and the post-trade total |
| `minimumEntryEdgeBps` | `200` | Between `0` and `10000` |
| `maximumPriceImpactBps` | `100` | Between `0` and `10000` |
| `minimumSecondsToExpiry` | `60` | Non-negative integer |
| `maximumOpenPositions` | `3` | Positive integer |
| `readOnlyMode` | `true` | Overrides live enablement and prevents wallet loading |
| `liveTradingEnabled` | `false` | Must be explicitly enabled |
| `killSwitchEnabled` | `true` | Overrides live enablement |
| `walletAdapterPath` | unset | Required only after all live gates pass |

The CLI maps `STRYKE_READ_ONLY_MODE`, `STRYKE_LIVE_TRADING_ENABLED`,
`STRYKE_KILL_SWITCH_ENABLED`, and `STRYKE_WALLET_ADAPTER_PATH` to those gates.
Boolean values must be exactly `true` or `false`. Live execution also requires
the invited `STRYKE_API_BASE_URL` and devnet `STRYKE_SOLANA_RPC_URL`.
`STRYKE_CHECKPOINT_PATH` defaults to `.stryke/reference-bot-action.json`.

Signer custody stays inside the supplied wallet module, whose default export is
an `@solana/kit` `TransactionSigner`. Seed phrases, private keys, secret keys,
mnemonics, and signed transactions are not configuration. Use a separately
funded, minimally funded devnet pilot wallet.
