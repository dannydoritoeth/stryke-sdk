# Typed Error Recovery

Catch `StrykeSdkError`, inspect `code` and `retryable`, and log only its bounded
context. A retryable flag means the condition may recover; it does not override
quote freshness, action reconciliation, or any signing precondition.

| Code | Recovery precondition |
| --- | --- |
| `configuration` | Correct missing/invalid config; never add inline secrets |
| `compatibility` | Use the supported devnet API/schema/program combination |
| `validation` | Correct the caller input or reject the malformed response |
| `unsupported_asset` | Select BTC or SOL |
| `unsupported_expiry` | Select 1m, 5m, 15m, or 1h |
| `api_response` | Inspect status/path, fix the contract or wait for a healthy compatible API |
| `source_unavailable` | Wait for the exact required source; do not substitute |
| `source_stale` | Wait for a fresh exact-feed/market response |
| `quote_blocked` | Request a fresh quote after the blocking state clears |
| `intent_mismatch` | Discard the preparation and restart from exact intent/quote review |
| `wallet_rejected` | Stop; request wallet approval only for a newly reviewed intent |
| `simulation_failed` | Stop and diagnose; do not submit the failed simulation |
| `submission_failed` | Treat outcome as unknown and reconcile before any retry |
| `confirmation_timeout` | Reconcile signature/activity/position before any retry |
| `confirmation_unknown` | Preserve checkpoint and reconcile; do not duplicate |
| `blockhash_expired` | Prepare a fresh transaction with a fresh quote/state check |
| `duplicate_action` | Reconcile the existing checkpoint/action to an authoritative terminal state |
| `position_state` | Refresh authoritative position state and deadline |
| `claim_state` | Refresh claim/refund eligibility; do not infer it from Pyth |

Never retry a `submitted` or `unknown` action with a new `clientActionId`.
Authoritative `failed` or `expired` evidence is required before a new decision;
`confirmed` requires refreshed activity and position state.
