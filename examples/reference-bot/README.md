# `@stryke/reference-bot`

Runnable reference bot built exclusively on the public `@stryke/sdk` contract.
It defaults to paper mode, file-backed restart state, live trading disabled,
and the kill switch enabled.

```bash
npx @stryke/reference-bot --profile=paper --ticks=2
```

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
