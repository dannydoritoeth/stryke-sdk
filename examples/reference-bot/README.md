# `@stryke/reference-bot`

Runnable reference bot built exclusively on the public `@stryke/sdk` contract.
It defaults to paper mode, file-backed restart state, live trading disabled,
and the kill switch enabled.

From the source workspace, use the conservative public defaults directly:

```bash
npm run doctor:paper -w @stryke/reference-bot
npm run start:paper -w @stryke/reference-bot -- --ticks=2
```

Copy `.env.example` to `.env` only to customize those defaults.

The package is not published to npm. After installing the two immutable
release tarballs described in `docs/artifact-handoff.md`, its installed binary
can instead be checked and run as:

```bash
npx stryke-reference-bot doctor --profile=paper
npx stryke-reference-bot --profile=paper --ticks=2
```

Doctor exits `0` for ready, `2` for healthy market waiting, and `1` for a
blocked setup. Its final `reference_bot_doctor` JSON line includes the stable
status, reason, remediation, market identity, configured and authoritative
minimums, and matched quote IDs when available.

Live and devnet profiles require the explicit controls documented in the SDK
repository's `docs/configuration.md`, including a wallet adapter. Never put a
private key or seed phrase in environment variables.

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
