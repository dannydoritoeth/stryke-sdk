# Cleanup Lifecycle Compatibility Regression Plan

Status: In progress
Date: 2026-08-12

## Problem

The published `0.1.14` reference bot contains restart-safe claim, refund and
user-position rent recovery, but a mainnet canary exposed two gaps:

1. `PositionsClient` rejects a production claimable position whose
   `cleanup.staleCleanup.action` is `claim`; the parser currently accepts only
   `close_position` even when `selfCloseAvailable` is false.
2. `close_all` recovers wallet-owned user-position rent but the public API does
   not yet include eligible shared strike/series/escrow cleanup paid by an
   empty-market bootstrap trader. The reference bot cannot claim full wallet
   reconciliation until that public contract is available.

No protocol change is required. Production already stores the setup rent
recipient and permits normal terminal strike and series closure.

Production paper verification also exposed a security regression: the
structured effective-config event printed the full configured Solana RPC URL,
including any path/query credential. The direct cause is `publicConfig`
returning endpoint strings unchanged. Missing credential-bearing endpoint
fixtures are the detection gap; relying only on database/wallet-field redaction
is the design gap. Endpoint credentials must never be logged in any mode.

## Requirements

- SDK position parsing accepts the production lifecycle actions `claim`,
  `refund`, and `close_position` without converting claim/refund into cleanup.
- `positionCleanupAvailable` is true only when `selfCloseAvailable` is true and
  the authoritative action is `close_position`.
- Invalid action/type/timestamp combinations continue to fail closed.
- The reference bot orders terminal claim/refund before close. While entries
  are enabled, a protocol-time-locked rent cleanup is recorded but does not
  block evaluation of a different eligible market. Drain continues to wait for
  and execute that cleanup before declaring completion.
- A future compatible API `close_all` plan may include wallet-position and
  eligible shared-market cleanup; the SDK executes the API-authored reviewed
  plan without inventing accounts or recipients.
- Release evidence uses a production-shaped claimable fixture and repeated
  claim -> close -> reconcile iterations.
- The public CLI exposes `drain --profile=devnet|live`. Drain uses the normal
  wallet/checkpoint/API/reviewer/executor composition, disables entry at the
  final runtime decision point, and completes only after two consecutive fresh
  iterations find no pending reconciliation, terminal action, cleanup action,
  or waiting cleanup.
- Drain emits `reference_bot_drain_complete` exactly once and exits zero on
  success. Stale/unavailable state, a retained checkpoint, an unknown action,
  timeout, or interruption cannot emit completion.
- Public configuration output reduces every endpoint to its URL origin and
  strips username, password, path, query, and fragment. Runtime bindings retain
  the full configured value. Invalid URLs fail validation without being echoed.

## Pseudocode

```text
parse cleanup:
  validate rent recipient, booleans, timestamp and status
  require action in {claim, refund, close_position, undefined}
  if selfCloseAvailable:
    require action == close_position
  expose cleanup.action only for close_position

runtime tick:
  reconcile pending action
  if claimable/refundable: execute terminal action
  else if closeable: execute API-authored cleanup plan
  else if cleanup pending and entry_enabled=false: wait
  else if cleanup pending and entry_enabled=true: retain cleanup observation
    and evaluate the next market through normal risk/duplicate controls
  else evaluate entry

drain CLI:
  run the normal runtime with entry_enabled=false
  reset clean_count after every reconciliation/action/wait/error
  increment clean_count only when lifecycle inspection reaches entry_disabled
  after two consecutive clean ticks emit reference_bot_drain_complete and exit
```

## Tests

- `production_claimable_cleanup_action_is_parsed_for_terminal_claim`
- `production_refundable_cleanup_action_is_parsed_for_terminal_refund`
- `self_close_requires_close_position_action`
- `invalid_cleanup_action_fails_closed`
- existing composed repeated lifecycle and restart tests remain green
- downstream API composition must prove shared position -> strike -> series
  recovery before the next funded canary
- `drain_cli_claims_closes_observes_two_clean_ticks_and_never_enters`
- `drain_cli_restart_reconciles_before_continuing`
- `drain_cli_does_not_complete_for_pending_or_stale_state`
- `public_config_strips_rpc_path_query_fragment_and_credentials`
- `runtime_binding_retains_full_rpc_endpoint_after_log_redaction`
- `live_mode_continues_entry_evaluation_while_rent_cleanup_is_time_locked`
- drain variants prove future cleanup still blocks both clean observations

## Phases

1. Fix and test cleanup parsing.
2. Publish an immutable patch release with commit and npm integrity evidence.
3. Add and publish the composed drain CLI with multi-iteration/restart proof.
4. Consume the release from the product Render artifact intake.
5. Complete the product API shared-rent cleanup plan and composition proof.
6. Run paper validation, then one bounded live canary through final wallet
   reconciliation.

## Done Done

Done Done requires a published immutable SDK/reference-bot patch, production-
shaped parser tests, product API support for complete recoverable rent, Render
running the new receipt, two real supervisor lifecycle iterations, and one
bounded live canary that ends with no claimable/refundable/closeable position or
shared setup-rent account and an explained wallet delta. Until then live rollout
remains blocked.
