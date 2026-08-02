# PRD 01 Implementation Plan: Polymarket Early And Late Relative Value

Status: In progress — phases 1–4 implemented and locally verified; deployed
API timing evidence and signed Phase 5 devnet matrix remain

Linked PRD: [01-polymarket-early-late-relative-value.md](01-polymarket-early-late-relative-value.md)

## Architecture and separation of concerns

| Surface | Ownership |
| --- | --- |
| Upstream Stryke API | Authoritative `closingStartsAt`, policy version and market identity. No SDK-local schedule duplication. |
| `packages/sdk/src/markets.ts` / `quotes.ts` | Parse, type and validate timing and quote economics. No strategy decisions. |
| `examples/reference-bot/src/polymarket-client.ts` | Read-only fresh Polymarket top-of-book data and identity/spread checks. No Stryke economics. |
| New `strategy/polymarket-entry.ts` | Pure executable-edge, payout and expected-value calculations. |
| New `strategy/entry-window.ts` | Pure early/late timing decisions from authoritative timestamps. |
| New `strategy/polymarket-exit.ts` | Explicit early exit policies and late hold-only behavior. |
| `config.ts` | Parse and cross-validate controls; no strategy calculations. |
| `sdk-runtime.ts` | Fetch aligned inputs and execute one selected action. No hidden policy constants. |
| `bot.ts` | Ordered reconciliation/lifecycle orchestration only; split before adding more strategy math. |

Do not place the new calculations directly into `bot.ts`, and do not reuse the
generic volatility estimator's `0.5` placeholder in a Polymarket decision.

## Configuration design

| Control | Proposed values/default | Runtime consumer |
| --- | --- | --- |
| `STRYKE_STRATEGY` | `polymarket_early`, `polymarket_late`; retain existing estimators as separately documented baselines | strategy dispatcher |
| `STRYKE_POLY_EARLY_WINDOW_SECONDS` | positive duration appropriate to expiry family | early window calculator |
| `STRYKE_POLY_LATE_WINDOW_SECONDS` | positive lookback before fee onset | late window calculator |
| `STRYKE_POLY_SUBMISSION_BUFFER_SECONDS` | positive and less than late window | final eligible late timestamp |
| `STRYKE_POLY_ENTRY_EDGE_BPS` | existing control | executable relative-edge gate |
| `STRYKE_POLY_MIN_HOLD_RETURN_BPS` | non-negative | hold EV gate |
| `STRYKE_POLY_MIN_WIN_PROFIT_BPS` | non-negative | projected win-profit gate |
| `STRYKE_POLY_EXIT_POLICY` | `hold_to_expiry`, `exit_on_convergence`, `risk_managed`; valid only for early | exit dispatcher |
| `STRYKE_POLY_EXIT_EDGE_BPS` | existing control | convergence exit |

Late mode forces `hold_to_expiry`; conflicting exit configuration fails at
startup. Existing kill switch, trade/exposure, impact, freshness, spread,
timeout, stop-loss and take-profit controls retain their current meanings.

## Pseudocode

### SDK timing validation

```text
parse_closing_protection(row, market):
  require policyVersion is supported
  require closingStartsAt and hardLockTs are safe timestamps
  require intervalStartTs < closingStartsAt < hardLockTs <= expiryTs
  require quote phase and current time are coherent with boundaries
  return immutable typed schedule
```

### Entry window

```text
entry_window(strategy, market, schedule, now, config):
  if strategy == early:
    if now < market.intervalStartTs: return wait(before_early_window)
    if now > intervalStartTs + earlyWindow: return skip(early_window_closed)
    return eligible

  decisionStart = schedule.closingStartsAt - lateWindow
  decisionEnd = schedule.closingStartsAt - submissionBuffer
  if now < decisionStart: return wait(before_late_window)
  if now >= decisionEnd: return skip(late_window_closed)
  if quote.phase != open or effectiveFeeBps != baseFeeBps:
    return blocked(closing_fee_started)
  return eligible
```

### Executable entry economics

```text
evaluate_side(quote, polyAskBps, thresholds):
  cost = integer quote gross debit
  payout = integer resulting-position Winning Payout
  require payout > 0

  costProbabilityBps = ceil(cost * 10_000 / payout)
  relativeEdgeBps = polyAskBps - costProbabilityBps
  profitIfWins = payout - cost
  winProfitBps = floor(profitIfWins * 10_000 / cost)
  holdExpectedValue = floor(polyAskBps * payout / 10_000) - cost
  holdReturnBps = floor(holdExpectedValue * 10_000 / cost)

  pass = relativeEdgeBps >= entryEdgeBps
      && profitIfWins > 0
      && winProfitBps >= minimumWinProfitBps
      && holdExpectedValue > 0
      && holdReturnBps >= minimumHoldReturnBps
  return all values and pass/failure reason

evaluate_entry(quotes, polyBooks):
  require paired quote identity, size and state version
  evaluate Up and Down independently
  rank passing sides by holdReturnBps, then relativeEdgeBps
  on exact tie: skip
```

Use conservative integer rounding: cost probability rounds up; returns round
down. Tests must cover one-unit boundaries.

### Early exit

```text
evaluate_early_position(position, sellQuote, polyBid, policy):
  if policy == hold_to_expiry: return hold

  currentValue = sellQuote expected net proceeds
  winningPayout = API-authored position payout
  referenceHoldValue = floor(polyBid * winningPayout / 10_000)
  remainingEdge = polyBid - executableSellProbability

  if policy == risk_managed and stopLoss/takeProfit reached:
    return sell(reason)
  if remainingEdge <= configuredExitEdge
     or currentValue >= referenceHoldValue:
    return sell(convergence)
  return hold

on missing/stale Polymarket data:
  hold and retry while sell remains possible
```

### Late lifecycle

```text
late_cycle():
  reconcile pending action first
  if an open late position exists:
    hold until API lifecycle is claimable/refundable/lost
    execute at most one claim/refund
    return
  evaluate current aligned market and timing window
  evaluate executable edge and hold economics
  buy at most one side or record exact skip/block reason
```

## Phases

### Phase 1: Upstream timing contract

Status: code complete on the service feature branch; deployment/readback pending.

- Add and deploy authoritative `closingStartsAt` with policy identity in the
  service repository.
- Add service success, boundary, malformed-policy and clock-transition tests.
- Capture one devnet 5m/15m/1h readback showing coherent fee-start/hard-lock
  times.

Gate: late strategy remains blocked until deployed API evidence exists.

### Phase 2: SDK contract and executable economics

Status: complete and verified locally.

- Parse the timing field fail-closed.
- Add pure integer entry-economics helper and public diagnostic type.
- Prove amount, fees, price impact and projected payout reach the final
  calculation.
- Update packed external-consumer fixtures.

Gate: SDK, compatibility, consumer and public-boundary tests pass.

### Phase 3: Reference-bot strategy policies

Status: complete and verified locally.

- Add early/late configuration and validation.
- Implement entry windows, both-side ranking and explicit exit policies.
- Remove the Polymarket path's hard-coded `0.5` hold valuation.
- Preserve one-action-per-tick, checkpoint and same-round protections.
- Add structured decision diagnostics without wallet material, raw signed
  transactions or secrets.

Gate: all configuration controls reach isolated final consumers and focused
strategy/runtime tests pass.

### Phase 4: Public CLI composition and documentation

Status: complete and verified locally.

- Update `.env.example`, README, configuration, mechanics and troubleshooting.
- Add simple early-paper and late-paper example configurations/commands.
- Exercise buy/hold/convergence or expiry/terminal/next-round order through the
  real CLI for at least two rounds, plus restart reconciliation.

Gate: build, typecheck, full tests, docs contract, config register, strategy
claim and actual CLI fixtures pass.

### Phase 5: Devnet verification and handoff

- Run paper observation first with no signing.
- Run minimum-size signed devnet cells across BTC/SOL, 5m/15m/1h, early/late
  and both selected sides over the combined matrix.
- Require at least two complete cycles for each strategy, including late hold
  through settlement and terminal processing.
- Record run IDs, candidate commit, configuration, decisions, signatures and
  lifecycle outcomes without secrets.
- Publish the reviewed commit/tag only after all gates pass.

## Named tests

### SDK

- `sdk_accepts_coherent_authoritative_closing_fee_onset`
- `sdk_rejects_missing_or_incoherent_closing_fee_onset`
- `sdk_preserves_closing_policy_identity_through_quote_preparation`
- `executable_entry_cost_uses_gross_debit_and_projected_payout`
- `executable_entry_math_rounds_cost_up_and_returns_down`
- `trade_size_fee_and_price_impact_change_effective_entry_probability`
- `packed_consumer_reads_closing_fee_onset_and_entry_economics`

### Strategy and configuration

- `early_strategy_enters_at_open_and_exact_window_end`
- `early_strategy_waits_before_open_and_skips_after_window`
- `late_strategy_waits_then_enters_before_submission_buffer`
- `late_strategy_skips_at_buffer_fee_onset_and_lock_boundaries`
- `late_strategy_rejects_edge_when_win_profit_is_not_positive`
- `late_strategy_rejects_positive_edge_with_insufficient_hold_ev`
- `late_strategy_selects_side_with_best_conservative_hold_return`
- `late_strategy_forces_hold_to_expiry_and_rejects_conflicting_exit_policy`
- `early_hold_policy_ignores_convergence`
- `early_convergence_policy_uses_polymarket_bid_not_fifty_percent`
- `early_risk_managed_policy_applies_stop_loss_and_take_profit`
- `polymarket_unavailable_fails_entry_closed_and_holds_existing_position`
- `every_new_env_control_reaches_its_final_runtime_consumer`

### Runtime/composition

- `early_cli_completes_entry_convergence_exit_terminal_and_next_round`
- `early_cli_holds_to_expiry_when_configured`
- `late_cli_waits_enters_before_fees_holds_claims_and_repeats`
- `late_cli_does_not_submit_when_decision_finishes_inside_safety_buffer`
- `restart_reconciles_early_and_late_actions_without_duplicate_submission`
- `reference_recovery_enters_only_while_the_original_window_remains_eligible`

## Path coverage matrix

| Surface | Success | Legitimate alternatives | Errors | Recovery | Composition evidence |
| --- | --- | --- | --- | --- | --- |
| Market alignment | Exact BTC/SOL 5m/15m/1h token identity | Native 1m and degraded aligned round skip | Missing/mismatched token IDs fail closed | Later correctly aligned round becomes eligible | CLI observes skip then next-round evaluation |
| Entry economics | Positive executable edge, win profit and hold EV | Either side; exact threshold; tie skips | Missing/stale/inconsistent payout or quote blocks | Fresh quote on later eligible tick | CLI records all calculation inputs |
| Early timing | Entry inside open window | Before window waits; after window skips | Invalid duration/config fails startup | Restart inside window may continue after reconciliation | Two early rounds through CLI |
| Late timing | Entry before fee onset and safety buffer | Too early waits; final window can skip | Closing/locked/incoherent schedule blocks | Dependency recovery only within original window | Two late hold-to-terminal rounds through CLI |
| Early exit | Configured hold, convergence or risk exit | Polymarket unavailable safely holds | Stale/expired sell quote prevents submission | Fresh reference/quote permits later exit | CLI convergence and expiry variants |
| Late lifecycle | Hold, then claim winning position | Lost position completes; refundable position refunds | Non-actionable terminal state does nothing | Pending terminal action reconciles after restart | CLI claim/refund and next round |
| Configuration | Valid defaults and boundaries | Explicit supported policy variants | Missing, malformed, outside-boundary and conflicting values fail startup | Corrected config succeeds after restart | Config register plus CLI profile output |

## Logging and evidence

Each decision event should include market/round identity, strategy mode,
seconds since open, seconds until fee onset, safety buffer, selected side,
Polymarket bid/ask age and spread, Stryke effective cost probability, fee,
price impact, projected payout, profit if wins, hold expected value/return,
thresholds and final reason. Exclude wallet secrets, key paths, raw transaction
bytes and signed payloads. Transaction/checkpoint persistence remains the
financial action record; no new database is required in this repository.

## Traceability

| Requirement | Phase | Implementation | Test evidence |
| --- | --- | --- | --- |
| POLY-01, POLY-04, POLY-05 | 3 | config, dispatcher, entry-window module | early/late boundary and CLI tests |
| POLY-02 | 2-3 | SDK market reference plus Polymarket client | identity/degraded/recovery tests |
| POLY-03, POLY-06 | 2-3 | quote economics plus polymarket-entry module | integer economics boundary tests |
| POLY-07, POLY-08 | 3-4 | polymarket-exit plus lifecycle orchestration | policy, terminal and repeated CLI tests |
| POLY-09 | 3-5 | runtime structured events and evidence files | logging redaction and devnet evidence |
| POLY-10 | 3-4 | config parser and register | config-control gate |
| POLY-11 | 4-5 | public CLI and matrix runner | two-cycle, restart and signed matrix evidence |

## Done Done checklist

- [ ] Upstream API timing contract is deployed and evidenced on devnet.
- [x] SDK types/parsers/economics and packed consumer pass.
- [x] Early strategy passes all entry and selected exit-policy paths.
- [x] Late strategy passes timing, payout, expected-value and hold-to-terminal paths.
- [x] All new controls pass default/boundary/malformed/conflict/runtime-consumer tests.
- [ ] Full repository tests, build, typecheck, docs and boundary gates pass; publication strategy claim remains intentionally closed pending signed devnet evidence.
- [x] Actual CLI proves two cycles and restart safety for both strategies.
- [ ] Signed minimum-size devnet matrix is recorded against the candidate commit.
- [x] README and onboarding are concise and truthful for the locally verified candidate.
- [ ] Working tree is clean and the reviewed candidate is pushed/tagged for handoff.
