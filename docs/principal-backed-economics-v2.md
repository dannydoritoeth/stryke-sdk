# Principal-Backed Economics V2 Delivery

Status: Code complete through runtime composition; deployed V2 candidate evidence open

This repository must consume Stryke's authoritative V2 economics without
recomputing payouts from pool totals or relying on V1 curve fields. Delivery is
ordered SDK -> reference bot -> actual CLI composition -> deployed-candidate
evidence.

## Required behavior

- Quotes require `economicVersion: 2` and exact integer principal,
  participation, surplus, executable value and winning-payout fields.
- Quote and resulting-position valuations must agree with the economics block.
- Positions consume API-authored side valuations. The SDK must not derive a
  winning payout from aggregate pool shares.
- Transaction preparation remains bound to the complete quote identity.
- Missing, stale, malformed, V1 or internally inconsistent economics fail
  before signing.
- The bot uses executable Current Value for exits and authoritative Winning
  Payout for hold decisions and accounting. Unfunded desired curve value is
  never treated as realizable.

## Pseudocode

```text
parse_quote(payload):
  require supported program, math and economic version
  parse every required integer field
  require action output, fee and valuation identities agree
  return immutable authoritative economics

parse_position(row):
  require economicVersion == 2
  split owned Up/Down exposures
  attach API-authored Current Value and Winning Payout to each exposure
  reject missing or inconsistent active-position valuation

bot_cycle():
  reconcile pending action
  load V2 positions and quotes
  decide using executable value and authoritative payout
  execute at most one bound action
  reconcile confirmation before next cycle
```

## Phases and acceptance gates

1. **SDK parsing and compatibility** - named tests cover success, zero-surplus,
   backed-premium, terminal alternatives, V1/stale/malformed rejection and
   quote-to-prep identity. Full SDK, consumer, build and public-boundary gates
   pass.
2. **Reference-bot semantics** - entry/exit/hold/claim/refund accounting uses
   only SDK V2 fields. Tests cover positive, zero and unavailable branches.
3. **Runtime composition** - the public CLI completes two ordered cycles,
   restart reconciliation and every documented config consumer. Helper-only
   tests do not satisfy this gate.
4. **Candidate evidence** - after a V2 devnet deployment, run the signed BTC/SOL
   and 1m/5m/15m/1h matrix. Until then, the repository may be code-complete but
   is not release-evidence complete.

## Repository-local implementation evidence

- SDK V2 parsing and compatibility: `cc6e3fb`, tests `f7af57e`.
- Reference-bot authoritative position economics: `d2c8eb4`, tests `1d9bcf0`.
- The actual `test:polymarket-fixture` CLI is exercised by
  `reference_bot_completes_two_dual_entitlement_market_cycles`: it enters,
  holds, exits, blocks same-round re-entry across a restarted loop, then enters
  the next round.
- `check:config-controls` remains the exhaustive env/file-to-runtime consumer
  gate. Candidate signed devnet evidence cannot close until the V2 program/API
  deployment exists.

## Named tests

- `sdk_decodes_dual_entitlement_quote_exactly`
- `sdk_positions_use_authoritative_v2_valuations`
- `sdk_and_bot_fail_closed_on_unverifiable_economics`
- `bot_exit_uses_executable_not_desired_curve_value`
- `bot_hold_path_uses_terminal_principal_and_upside`
- `strategy_matrix_covers_economic_alternative_states`
- `reference_bot_restart_reconciles_dual_entitlement_action_once`
- `reference_bot_config_controls_reach_execution_and_lifecycle`
- `reference_bot_completes_two_dual_entitlement_market_cycles`
