# Stryke SDK Pilot

Open-source TypeScript SDK and reference bot for trading Stryke ([https://stryketrade.com](https://stryketrade.com))
BTC/SOL markets. This is educational software, not investment advice;
outcomes are not guaranteed. Node.js 22+ is required.

The SDK supplies typed markets, Pyth prices/history, executable quotes, reviewed
transactions, restart-safe reconciliation, positions, sells, claims, and
refunds. The reference bot continuously reconciles → evaluates every open
position → manages/exits → settles → evaluates the next market.

The SDK requires principal-backed economics V2. Quotes expose exact principal,
participation, executable Current Value and Winning Payout fields. Active
positions consume the API-authored side valuation; neither the SDK nor the bot
recomputes payout from aggregate pools. Missing, stale, V1 or inconsistent
economics stop before signing.

The default `polymarket_early` baseline compares both executable Stryke sides
with the aligned Polymarket asks shortly after a round opens. It buys only when
the total debit, fee, price impact, projected Winning Payout, expected return
and win profit all pass the configured thresholds. `polymarket_late` performs
the same check in a bounded window immediately before Stryke closing fees begin,
keeps a submission buffer, then holds through settlement. Neither strategy
trades on Polymarket or guarantees profit.

When both real Stryke pools are exactly empty, the default minimum-size bot may
make the first trade on the stronger Polymarket side if the configured entry
edge passes. Disable this with `STRYKE_POLY_BOOTSTRAP_EMPTY_MARKET=false`. The
exception ends as soon as either real pool is funded; normal payout and
expected-return gates then apply.

The included volatility- and time-adjusted estimator is an inspectable baseline,
not a guaranteed profitable strategy.

## Three-step confidence ladder

After the first npm release is published:

```bash
npm install @stryketrade/sdk @stryketrade/reference-bot
npx stryke-reference-bot doctor --profile=paper
npx stryke-reference-bot --profile=paper --ticks=2
```

Doctor reports whether setup is ready, waiting for an eligible market, or
blocked. The bounded command observes two complete loop iterations and exits.
Copy `.env.example` to `.env` only to inspect or customize the conservative
public defaults. Remove `-- --ticks=2`
only when you want the continuous process. Paper mode reads real markets,
Pyth prices, and quotes but never loads a wallet or submits a transaction.
From a source checkout, the equivalent command is
`npm run start:paper -w @stryketrade/reference-bot -- --ticks=2`.

```bash
npm run start:live -w @stryketrade/reference-bot
```

Live mode uses the mainnet API/RPC values and a separately funded wallet adapter
to make minimum-size signed mainnet trades when the estimator and every safety
gate pass. It continuously manages positions, exits or waits for expiry,
claims/refunds, reconciles, and repeats.

Mainnet execution remains protected by every configured safety gate.

Before the first signed run, follow the [quickstart wallet steps](docs/quickstart.md#2-create-and-fund-a-dedicated-trading-wallet) to create a dedicated keypair, fund its public address, and set its file path in `.env`. Devnet compatibility remains available through `npm run start:devnet -w @stryketrade/reference-bot` with devnet API and RPC values.

The credential-free default is `baseline`. Opt in to the external-reference
early strategy with `STRYKE_STRATEGY=polymarket_early`. For the
pre-fee strategy, set `STRYKE_STRATEGY=polymarket_late` and
`STRYKE_POLY_EXIT_POLICY=hold_to_expiry`. Both support aligned `5m`, `15m`,
and `1h` rounds; native 1m and degraded-reference rounds are skipped. Early can
hold to expiry, exit when prices converge, or use the existing risk controls.
Late always holds to expiry because its entry window is intentionally close to
the fee schedule and lock.
Replace only the exported estimator seam in `examples/reference-bot/src/strategy.ts`
for your own signal. Every run prints
effective non-secret config and each waiting, blocked, hold, entry, exit, claim,
or refund reason. No command forces a trade.

Each quote includes authoritative `closingStartsAt` and hard-lock timing.
During `closing` or `locked`, the bot opens no position; during `locked`, it holds any
existing position until settlement, then claims or refunds once. Locked trades
are not retried for that market.

Startup prints one structured preflight line per dependency. A failed line
includes a `remediation` field with the next command or setting to fix; the bot
exits before its loop or signing. Paper explicitly skips wallet, RPC, and
funding checks. See [error recovery](docs/troubleshooting.md#startup-preflight)
for the short checklist.

Never put a seed phrase, private key, secret key, or signed transaction in config
or logs. See the [quickstart](docs/quickstart.md),
[configuration](docs/configuration.md), [market mechanics](docs/market-mechanics.md),
[artifact handoff](docs/artifact-handoff.md),
[npm publication](docs/npm-publishing.md), and
[error recovery](docs/troubleshooting.md).

No included strategy guarantees accuracy or profit. The recommended baseline
is deliberately small and inspectable; validate and calibrate it for your own
use before risking funds.
