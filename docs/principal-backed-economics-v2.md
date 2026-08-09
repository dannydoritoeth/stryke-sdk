# Principal-Backed Economics V2 Delivery

Status: Done Done on devnet; independent audit and mainnet approval remain external release gates

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
- Principal-backed sell quotes require the owner identity because executable
  proceeds depend on that owner's remaining protected principal. The reference
  bot always supplies its signer address; a missing sell owner fails before an
  API request.
- Missing, stale, malformed, V1 or internally inconsistent economics fail
  before signing.
- A confirmed transaction may briefly precede its indexed V2 valuation.
  Explicit wrong versions remain permanent failures; missing post-confirmation
  valuation is retryable stale data. The reviewed executor retries that refresh
  for a bounded window and retains its checkpoint until refresh succeeds.
- A complete economics block remains authoritative when a valid valuation
  intentionally omits an unavailable optional metric (for example Current
  Value and Current P&L before a position has executable sell value). Compare
  every valuation metric that is present; do not treat an absent optional
  metric as an economics mismatch.
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

Verified on 2026-07-30 against `dda6a98` plus the implementation commits listed
above:

- `npm test`: 39 files, 258 tests passed.
- `npm run build` and `npm run typecheck`: SDK and reference bot passed.
- `npm run test:consumer`: the packed SDK consumer contract passed.
- `npm run check:public-boundary`: passed.
- `npm run check:config-controls`: passed.
- `npm run check:strategy-claim`: passed; the stronger strategy claim remains
  intentionally unpublished until fresh deployed-candidate evidence exists.
- `npm run test:polymarket-fixture -w @stryketrade/reference-bot`: the actual CLI
  emitted `buy -> hold -> sell -> same-round skip -> next-round buy`, proving
  two ordered market cycles through the composition entrypoint.

These results closed phases 1-3. Phase 4 subsequently passed against the
deployed V2 program and API candidate. Signed run
`bot-matrix-20260730T210454747Z`, recorded in
`docs/evidence/principal-backed-v2-devnet-matrix-20260731.json`, exercised the
actual reference-bot CLI for BTC and SOL across 1m, 5m, 15m and 1h. All eight
cells exited successfully, completed a confirmed lifecycle, evaluated the next
market, and passed the paper-mode safety check. Every cell performed confirmed
buy and sell actions; SOL 1m completed two buy/sell cycles.

The deployed-candidate run found and closed three integration gaps before this
claim was made:

- optional unavailable Current Value was incorrectly compared with economic
  zero even though the complete economics block was authoritative;
- owner identity was not forwarded for principal-backed sell quotes; and
- transaction confirmation could precede indexed V2 valuation materialization.

The SDK now compares only present optional valuation fields, requires and
forwards the owner for sells, and retries the bounded post-confirmation refresh
without clearing its restart checkpoint early. Final verification against
`274f427` passed `npm test` (39 files, 261 tests), build, typecheck, packed
consumer installation, public-boundary checks and the 40-control runtime
register. Independent contract audit and mainnet authorization are not claims
made by this repository evidence.

## Named tests

- `sdk_decodes_dual_entitlement_quote_exactly`
- `sdk_accepts_authoritative_economics_with_unavailable_optional_current_value`
- `sdk_requires_and_forwards_owner_for_principal_backed_sell_quotes`
- `confirmed_action_retries_transient_v2_materialization_before_clearing_checkpoint`
- `sdk_positions_use_authoritative_v2_valuations`
- `sdk_and_bot_fail_closed_on_unverifiable_economics`
- `bot_exit_uses_executable_not_desired_curve_value`
- `bot_hold_path_uses_terminal_principal_and_upside`
- `strategy_matrix_covers_economic_alternative_states`
- `reference_bot_restart_reconciles_dual_entitlement_action_once`
- `reference_bot_config_controls_reach_execution_and_lifecycle`
- `reference_bot_completes_two_dual_entitlement_market_cycles`
