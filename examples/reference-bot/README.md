# `@stryketrade/reference-bot`

Runnable reference bot built exclusively on the public `@stryketrade/sdk` contract.
It defaults to paper mode, file-backed restart state, live trading disabled,
and the kill switch enabled.

Install the public packages and use the conservative defaults directly:

```bash
npm install @stryketrade/sdk @stryketrade/reference-bot
npx stryke-reference-bot doctor --profile=paper
npx stryke-reference-bot --profile=paper --ticks=2
```

Copy `.env.example` to `.env` only to customize those defaults.

Paper execution consumes real production market, oracle, reference, and
executable quote data but never loads a signer or calls a live transaction
method. Selected buys are persisted as simulated positions at
`<STRYKE_ROUND_STATE_PATH>.paper-ledger.json`; restart resumes the same
position. The simulator holds to authoritative resolution and uses the entry
quote's projected winning payout for its clearly labelled terminal result.
That assumption is not a guaranteed fill, return, or profit.

Doctor exits `0` for ready, `2` for healthy market waiting, and `1` for a
blocked setup. Its final `reference_bot_doctor` JSON line includes the stable
status, reason, remediation, market identity, configured and authoritative
minimums, and matched quote IDs when available.

Live inherits paper's conservative public controls and requires a dedicated
wallet adapter/keypair plus funding. Devnet additionally requires explicit
devnet endpoints. Advanced overrides are documented in the SDK repository's
`docs/configuration.md`. Never put a private key or seed phrase directly in an
environment variable.

An API-authoritative `cleanup_available` position is part of the live
lifecycle. Before another entry, the bot validates the portfolio `close_all`
plan, simulates and signs it, confirms it, and reconciles disappearance of the
empty position account through the durable checkpoint. The successful event is
`close:wallet_rent_recovered`; read-only mode reports `cleanup_dry_run`, and
paper mode cannot load or sign cleanup. This reclaims wallet-owned position
rent only—not shared market initialization costs.
Before `cleanupEligibleAt`, it reports `cleanup_not_yet_eligible` with that
timestamp and does not evaluate another entry.
If the API's dedicated stale-cleanup status is not yet `eligible`, it reports
`cleanup_awaiting_authoritative_eligibility` and does not attempt a
transaction; zero shares alone do not prove cleanup eligibility.

To perform cleanup without allowing a new market entry, use the bounded
recovery command. It may run lifecycle recovery below the new-entry funding
reserve:

```bash
npx stryke-reference-bot recover-rent --profile=live
```

It submits at most the currently prepared cleanup chunk and exits. If nothing
is eligible it reports `no_cleanup_available`, `cleanup_not_yet_eligible`, or
`cleanup_awaiting_authoritative_eligibility`; it never evaluates an entry.

The normal continuous live command needs no separate cleanup invocation. On
every tick it reconciles any durable checkpoint, processes claim/refund, closes
an eligible empty position account, verifies that account disappears, and only
then evaluates the next market. If `close_all` contains multiple chunks, the
bot executes the chunk whose authoritative market identity matches the selected
position; later ticks process the remaining positions exactly once.
If no current market exists during startup, the continuous command reports a
waiting preflight state and continues into its retrying loop. `doctor` remains
bounded and reports `WAITING_FOR_MARKET` instead.

Cleanup is not a substitute for settlement. A non-winning position follows
`refundable -> refund -> cleanup_available -> close` only when the production
API authoritatively supplies the refundable state, amount, reason and deadline.
While a market is open, `sell` is the only economic exit; `claim` remains for a
resolved winner.

One local process needs no database:

```text
STRYKE_STATE_BACKEND=file
STRYKE_CHECKPOINT_PATH=.stryke/reference-bot-action.json
STRYKE_ROUND_STATE_PATH=.stryke/reference-bot-rounds.json
```

Operators needing shared restart state and deploy-overlap protection can use
the same public bot with Postgres:

```text
STRYKE_STATE_BACKEND=postgres
STRYKE_DATABASE_URL=postgres://user:password@host:5432/database
STRYKE_STATE_NAMESPACE=my-bot
STRYKE_LEASE_TTL_MS=30000
```

The database URL is redacted from effective configuration output. Postgres
failure or lease loss stops market work and never falls back to local state.
