# @stryke/sdk

Typed infrastructure for the private Stryke bot-developer pilot.

The package is not yet published to npm. Build and consume it from this
workspace while the pilot contract is being validated.

## Typed errors

All public SDK failures use `StrykeSdkError` and one of these stable codes:

- configuration and compatibility: `configuration`, `compatibility`,
  `validation`, `unsupported_asset`, `unsupported_expiry`, `api_response`;
- read and quote: `source_unavailable`, `source_stale`, `quote_blocked`;
- transaction and wallet: `intent_mismatch`, `wallet_rejected`,
  `simulation_failed`, `submission_failed`, `confirmation_timeout`,
  `confirmation_unknown`, `blockhash_expired`, `duplicate_action`; and
- position and resolution: `position_state`, `claim_state`.

`retryable` distinguishes transient failures. Error context is deliberately
bounded and strips credentials, API keys, signatures, signed transactions, and
raw payloads.

Market and position lifecycle evidence uses
`stryke.pilotLifecycle.v1`. Normalized state is always accompanied by the raw
status, raw reason, observation timestamp, and optional observed slot.

See the workspace [quickstart](../../docs/quickstart.md) and
[typed-error recovery guide](../../docs/troubleshooting.md) for recovery
preconditions and the deliberately gated reference flow.
