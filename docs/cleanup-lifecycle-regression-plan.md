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

## Requirements

- SDK position parsing accepts the production lifecycle actions `claim`,
  `refund`, and `close_position` without converting claim/refund into cleanup.
- `positionCleanupAvailable` is true only when `selfCloseAvailable` is true and
  the authoritative action is `close_position`.
- Invalid action/type/timestamp combinations continue to fail closed.
- The reference bot orders terminal claim/refund before close and does not
  enter a new market while recovery remains pending.
- A future compatible API `close_all` plan may include wallet-position and
  eligible shared-market cleanup; the SDK executes the API-authored reviewed
  plan without inventing accounts or recipients.
- Release evidence uses a production-shaped claimable fixture and repeated
  claim -> close -> reconcile iterations.

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
  else if cleanup pending: wait
  else evaluate entry
```

## Tests

- `production_claimable_cleanup_action_is_parsed_for_terminal_claim`
- `production_refundable_cleanup_action_is_parsed_for_terminal_refund`
- `self_close_requires_close_position_action`
- `invalid_cleanup_action_fails_closed`
- existing composed repeated lifecycle and restart tests remain green
- downstream API composition must prove shared position -> strike -> series
  recovery before the next funded canary

## Phases

1. Fix and test cleanup parsing.
2. Publish an immutable patch release with commit and npm integrity evidence.
3. Consume the release from the product Render artifact intake.
4. Complete the product API shared-rent cleanup plan and composition proof.
5. Run paper validation, then one bounded live canary through final wallet
   reconciliation.

## Done Done

Done Done requires a published immutable SDK/reference-bot patch, production-
shaped parser tests, product API support for complete recoverable rent, Render
running the new receipt, two real supervisor lifecycle iterations, and one
bounded live canary that ends with no claimable/refundable/closeable position or
shared setup-rent account and an explained wallet delta. Until then live rollout
remains blocked.
