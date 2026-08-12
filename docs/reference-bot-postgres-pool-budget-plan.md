# Reference Bot Postgres Pool Budget

Status: Implemented; release and production verification pending
Last updated: 2026-08-13

## Requirement

The reference bot's Postgres state backend must use an explicit bounded pool.
Production config sets a maximum of two connections, a five-second connection
timeout, a 30-second idle timeout, and a 300-second maximum connection
lifetime. Invalid configured values fail closed before the bot initializes its
state store. The database URL must never be logged.

Permanent controls:

```text
STRYKE_DATABASE_POOL_MAX=2
STRYKE_DATABASE_POOL_CONNECTION_TIMEOUT_MS=5000
STRYKE_DATABASE_POOL_IDLE_TIMEOUT_MS=30000
STRYKE_DATABASE_POOL_MAX_LIFETIME_SECONDS=300
```

## Pseudocode

```text
load config:
  parse each pool control as a positive integer
  reject zero, negative, fractional or non-numeric values

when stateBackend == postgres:
  construct PoolConfig from stateDatabaseUrl and pool controls
  set application_name to stryke-reference-bot
  initialize Postgres state using that bounded pool
```

## Tests

- `postgres_pool_controls_reach_runtime_pool_config`
- `postgres_pool_controls_reject_invalid_values`
- `paper_file_backend_does_not_require_database_pool_controls`

## Done Done

- Configuration, redacted config output, CLI runtime consumption and tests are
  complete.
- The immutable reference-bot artifact is released.
- The product deployment pins that artifact and proves the effective maximum
  is two connections.
