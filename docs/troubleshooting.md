# Typed Error Recovery

## Readiness doctor

Run paper doctor without credentials or an environment file:

```bash
npm run doctor:paper -w @stryke/reference-bot
```

The final `reference_bot_doctor` event uses schema
`stryke.referenceBotDoctor.v1`. Exit `0` means `READY_FOR_PAPER` or
`READY_FOR_LIVE`; exit `2` means `WAITING_FOR_MARKET`, which is healthy setup
waiting for the reported alignment or timing condition; exit `1` means
`BLOCKED` and its remediation must be applied before trading.

Live doctor uses `.env`, validates the wallet, RPC and funding path, and never
signs or submits:

```bash
npm run doctor:live -w @stryke/reference-bot
```

## Startup preflight

Read the first `reference_bot_preflight` line whose `status` is `failed`, apply
its `remediation`, and rerun the same command. Later errors are usually a
consequence of that first failed check.

| Failed check | What to do |
| --- | --- |
| `environment` | Run `cp .env.example .env`, inspect it, and retry |
| `api` | Correct `STRYKE_API_BASE_URL`; confirm the API is healthy and compatible |
| `pyth` | Check internet access and `STRYKE_PYTH_HERMES_URL`; never substitute another feed |
| `wallet` | Check both wallet paths; generate the dedicated keypair using the quickstart if missing |
| `rpc` | Correct `STRYKE_SOLANA_RPC_URL` and confirm it reaches the selected cluster |
| `funding` | Fund the dedicated wallet as directed by the printed `remediation` |

The wallet address and file path may be printed, but keypair bytes are never
printed. Do not paste the keypair JSON, a seed phrase, or signed transaction
into an issue, log, or coding-agent prompt.

To check the configured mainnet API, Pyth feed, wallet, RPC, and funding without
entering the trading loop or signing, run:

```bash
npm run start:live -w @stryke/reference-bot -- --preflight-only
```

Catch `StrykeSdkError`, inspect `code` and `retryable`, and log only its bounded
context. A retryable flag means the condition may recover; it does not override
quote freshness, action reconciliation, or any signing precondition.

| Code | Recovery precondition |
| --- | --- |
| `configuration` | Correct missing/invalid config; never add inline secrets |
| `compatibility` | Use a supported API/schema/program and mainnet-beta or devnet cluster combination |
| `validation` | Correct the caller input or reject the malformed response |
| `unsupported_asset` | Select BTC or SOL |
| `unsupported_expiry` | Select 1m, 5m, 15m, or 1h |
| `api_response` | Inspect status/path, fix the contract or wait for a healthy compatible API |
| `source_unavailable` | Wait for the exact required source; do not substitute |
| `source_stale` | Wait for a fresh exact-feed/market response |
| `quote_blocked` | If `context.phase` is `locked`/`expired`, do not retry that market; otherwise request a fresh quote after the blocking state clears |
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
