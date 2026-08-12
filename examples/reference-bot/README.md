# `@stryketrade/reference-bot`

Continuous paper/live reference bot built only on `@stryketrade/sdk`. Node.js
22+ is required.

## Start paper trading

From an empty directory:

```bash
npm init -y
npm install @stryketrade/sdk @stryketrade/reference-bot
npx stryke-reference-bot doctor --profile=paper
npx stryke-reference-bot --profile=paper
```

Paper mode uses production markets, Pyth prices, and executable quotes. It
never loads a wallet or submits a transaction. Simulated positions are stored
locally and resumed after restart. Add `--ticks=2` for a short check; otherwise
the bot runs until Ctrl-C.

Doctor exits `0` for ready, `2` for healthy market waiting, and `1` for a
blocked setup. Follow the printed remediation for the first failed check. No
command forces a trade.

## Move to live trading

Install the Solana CLI and create a dedicated wallet outside the project:

```bash
solana-keygen new --outfile ../stryke-trading-wallet.json
solana-keygen pubkey ../stryke-trading-wallet.json
```

Fund only the printed mainnet address with SOL you intend to risk. The JSON
file controls the wallet: never commit or share it, and do not use a personal
wallet.

Configure the adapter bundled with this installed package and the keypair:

```bash
export STRYKE_WALLET_ADAPTER_PATH="$PWD/node_modules/@stryketrade/reference-bot/wallet-adapter.example.mjs"
export STRYKE_WALLET_KEYPAIR_PATH="$PWD/../stryke-trading-wallet.json"
```

Check live readiness without signing, then explicitly start live trading:

```bash
npx stryke-reference-bot doctor --profile=live
npx stryke-reference-bot --profile=live
```

No `.env` or additional live-enable variable is required for this default path;
`--profile=live` applies the signed mainnet profile. Doctor validates the API,
market, Pyth data, wallet, mainnet RPC, and required balance without signing.
It prints the exact funding remediation when the wallet is short.

Live inherits paper's market, strategy, minimum-size, exposure, and safety
defaults. The trade size is checked against the API-authoritative minimum for
each market. Keep additional SOL for transaction fees, position-account rent,
and possible first-trader shared market initialization.

## Continuous lifecycle

Every live tick reconciles durable state before taking another action. It then
manages open positions, sells or waits for settlement, claims/refunds only when
the API authorizes them, closes eligible zero-share position accounts to return
rent, and finally evaluates the next market.

If the wallet is below the new-entry reserve, existing reconciliation and rent
recovery continue while new entries report `insufficient_funding`. To recover
eligible rent without permitting a new entry:

```bash
npx stryke-reference-bot recover-rent --profile=live
```

At an entry cutoff, use the continuous terminal lifecycle instead:

```bash
npx stryke-reference-bot drain --profile=live
```

Drain never evaluates or submits a new entry. It reconciles pending actions,
waits for settlement, claims/refunds, executes API-authored cleanup, and exits
only after two consecutive fresh lifecycle observations are clean. Successful
completion emits `reference_bot_drain_complete`; absence of that event is a
failed or incomplete drain.

Position-account rent can be recovered. Shared market-series or strike-market
initialization costs are recovered only when the API explicitly includes those
safe, authoritative instructions in the reviewed cleanup plan.

The default state is local:

```text
STRYKE_CHECKPOINT_PATH=.stryke/reference-bot-action.json
STRYKE_ROUND_STATE_PATH=.stryke/reference-bot-rounds.json
```

Keep these files across restarts. Paper positions use a derived local ledger.
Operators requiring shared state can select `STRYKE_STATE_BACKEND=postgres`
and set `STRYKE_DATABASE_URL` plus a stable `STRYKE_STATE_NAMESPACE`.

## Output and safety

Every run prints effective non-secret configuration and a reason for each
action, wait, or block. A BTC market identifier can contain `:SOL:` because SOL
is the collateral asset; the configured/token asset remains BTC.

Never put a private key, seed phrase, signed transaction, or database password
in logs or committed configuration. A signature proves submission, not
confirmation. Submitted or unknown actions retain their checkpoint and are
reconciled before another transaction.

Advanced environment controls and SDK mechanics are documented in the source
repository: <https://github.com/dannydoritoeth/stryke-sdk>.
