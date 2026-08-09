# PRD 01: Polymarket Early And Late Relative-Value Strategies

Status: Implementation-ready; awaiting product approval

Linked Implementation Plan: [01-polymarket-early-late-relative-value-plan.md](01-polymarket-early-late-relative-value-plan.md)

## Objective

Give invited bot developers two credible, understandable starting strategies
for aligned BTC and SOL Stryke markets:

- an **early relative-value strategy** that looks for a configurable executable
  discount to Polymarket shortly after a market opens, then applies an explicit
  exit-or-hold policy; and
- a **late relative-value strategy** that makes one decision shortly before
  closing fees start and enters only when both the relative edge and the
  economics of holding to expiry are worthwhile.

Neither strategy trades on Polymarket or promises profitability. Polymarket is
a read-only reference. Missing, stale, wide-spread or mismatched reference data
must fail closed for that decision.

## Product principles

1. Decisions use executable Stryke economics for the configured trade size,
   not displayed market odds alone.
2. A Polymarket probability difference is necessary but not sufficient. A buy
   must also pass payout, expected-value, fee, price-impact, exposure and timing
   gates.
3. Late entry must finish before the first closing-fee tier. It must not race
   the boundary or assume that the hard lock is the fee boundary.
4. Late positions hold to expiry by default. The strategy must show why the
   projected payout and conservative expected value justified that decision.
5. Early positions use one explicit exit policy. The bot must never silently
   combine an unrelated `50%` model with Polymarket exit logic.
6. API-authored Current Value and Winning Payout remain authoritative. Payout
   is a point-in-time projection and can change as later trades change the
   market.
7. The bot performs at most one economic action per loop tick and reconciles a
   pending action before making another decision.

## Requirements census

| ID | Requirement | Material dimensions |
| --- | --- | --- |
| POLY-01 | Provide separately configurable `polymarket_early` and `polymarket_late` strategy modes. | mode; paper/devnet |
| POLY-02 | Match only API-authored aligned markets with exact venue token identities. | BTC/SOL; 5m/15m/1h; Up/Down |
| POLY-03 | Compare the Polymarket ask with Stryke effective executable cost probability for entry. | Up/Down; fee/price impact; trade size |
| POLY-04 | Early entry is allowed only within a configured window after `intervalStartTs`. | before/in/after window; restart |
| POLY-05 | Late entry is allowed only in a configured window before authoritative closing-fee onset and outside the submission safety buffer. | before/in/after window; fee boundary; restart |
| POLY-06 | Late entry requires positive projected profit if the side wins and a configurable minimum conservative hold expected return. | positive/zero/negative profit; edge boundary |
| POLY-07 | Early positions support explicit `hold_to_expiry`, `exit_on_convergence`, and `risk_managed` policies. | policy; Up/Down; reference available/unavailable |
| POLY-08 | Late positions hold to expiry, then claim/refund through authoritative lifecycle state. | win/loss/refund; settlement wait |
| POLY-09 | Every decision emits non-secret timing, price, fee, payout and rejection diagnostics. | buy/skip/block/hold/sell/terminal |
| POLY-10 | Configuration is validated and traced from `.env` to its final runtime calculation or branch. | default/boundary/malformed/conflict |
| POLY-11 | The actual public CLI proves repeated market cycles and restart safety before handoff. | early/late; two cycles; restart |
| POLY-12 | Optionally bootstrap a completely empty aligned market with the configured micro trade so the bot may be first, while clearly distinguishing this liquidity-start action from a positive-EV entry. | enabled/disabled; exact empty state; Up/Down/tie; early/late |

## Scope

In scope:

- external `@stryketrade/sdk` parsing for the authoritative first closing-fee
  timestamp supplied by the Stryke API;
- reference-bot configuration, entry timing, executable-edge math, late hold
  economics, early exit policies, diagnostics and concise onboarding;
- BTC and SOL aligned 5m, 15m and 1h markets;
- paper-mode and signed micro-size devnet verification.

Out of scope:

- one-minute markets, because there is no aligned Polymarket reference;
- placing or hedging orders on Polymarket;
- smart-contract changes;
- promising arbitrage, accuracy or profit;
- mainnet trading enablement;
- new logging vendors, databases or monitoring infrastructure.

## Required upstream API contract

The market or quote response must expose the authoritative timestamp at which
the first closing-fee tier starts, named `closingStartsAt` in this plan. It must
be bound to the same market identity and closing-policy version as the quote.
The SDK must reject a missing, malformed or incoherent value for early/late
strategy use. The bot must not duplicate the fee schedule in local constants.

This repository owns consumption and validation only. The service change must
be implemented and verified in its authoritative repository before the late
strategy can be marked Done Done.

## Strategy behavior

### Common entry economics

For each side at one identical proposed size:

```text
total_cost = quote gross collateral debit
projected_payout = quote resulting-position projected Winning Payout
stryke_cost_probability_bps = total_cost / projected_payout * 10,000
reference_probability_bps = Polymarket executable ask
relative_edge_bps = reference_probability_bps - stryke_cost_probability_bps
hold_ev = reference_probability * projected_payout - total_cost
profit_if_wins = projected_payout - total_cost
```

The candidate side must pass all of:

- exact aligned market/token identity;
- fresh Polymarket book and acceptable spread;
- fresh Stryke quote and market state;
- `relative_edge_bps >= configured entry edge`;
- `profit_if_wins > 0` and configured minimum win-profit threshold;
- `hold_ev` and expected-return basis points at or above the configured
  minimum;
- price impact, trade size, aggregate exposure, open-position and kill-switch
  controls; and
- the selected strategy's timing gate.

### Empty-market bootstrap

When `STRYKE_POLY_BOOTSTRAP_EMPTY_MARKET=true` and both authoritative real
pools are exactly zero, the bot may place the configured trade size as the
first trade. It selects the side with the higher fresh Polymarket ask only when
that probability is at least `50% + STRYKE_POLY_ENTRY_EDGE_BPS`; an exact tie
or insufficient reference conviction skips. The normal timing, identity,
freshness, spread, impact, size, exposure, fee-phase, kill-switch and
one-entry-per-round controls still apply.

This is an explicit liquidity-start action. With no opposing principal its
initial projected win profit is zero, so it bypasses only the positive win
profit and hold-EV gates and must log `polymarket_empty_market_bootstrap`. As
soon as either real pool is non-zero, the standard executable-edge, win-profit
and hold-EV rules apply without exception. Virtual depth is not evidence of
real opposing principal.

Using a top-of-book price remains acceptable for the initial micro-size
baseline. Documentation must call it top-of-book reference pricing unless the
implementation also validates sufficient book quantity.

### Early relative-value strategy

- Evaluate entries only from interval open through the configured early-window
  end.
- Enter at most once per round.
- `hold_to_expiry`: ignore convergence and native P&L exits; wait for terminal
  state.
- `exit_on_convergence`: sell when fresh Polymarket bid versus executable
  Stryke sell value reaches the configured exit edge; if Polymarket is
  unavailable, hold safely and retry on the next tick.
- `risk_managed`: convergence plus configured stop-loss/take-profit using the
  authoritative executable Current Value and cost basis.
- Never substitute a hard-coded `50%` fair probability.

### Late relative-value strategy

- Wait until the late-decision window immediately before `closingStartsAt`.
- Stop attempting a new entry when the submission safety buffer begins.
- Require the current quote phase to remain `open` with no closing fee.
- Enter at most once per round; a skipped or blocked final window does not move
  the action into the fee-bearing phase.
- Hold an entered position through expiry and then claim/refund if the
  authoritative position lifecycle permits it.
- Log projected Winning Payout, profit if wins, reference probability,
  expected value, expected-return basis points and every timing boundary used.

## User/developer experience

The `.env.example` and configuration guide must make the choice obvious without
requiring code edits. Example profiles should remain minimum-size and explain:

- which strategy is selected;
- when it may enter;
- what edge and hold-return thresholds mean;
- whether an early position exits or holds;
- why a late trade was bought, skipped or blocked; and
- that payout and expected value are projections, not guarantees.

## Acceptance criteria

1. Early and late modes produce different timing behavior through the public
   CLI, not only policy helpers.
2. Entry math uses the actual quote debit and resulting Winning Payout; changing
   size, fee or curve execution changes the decision.
3. Late mode cannot enter before its window, inside the safety buffer, during a
   closing-fee phase or after lock.
4. Late mode cannot buy a positive relative edge with non-positive win profit
   or insufficient conservative hold expected value.
5. Early exit policy is explicit and the Polymarket path contains no `0.5`
   placeholder valuation.
6. A reference outage causes no trade; recovery on a later eligible tick can
   proceed without duplicate action.
7. Restart reconciliation prevents duplicate entry, exit, claim and refund.
8. Repository-local tests, packaging, public-boundary and config-control gates
   pass against one identified commit.
9. Paper composition runs at least two eligible rounds per strategy; signed
   devnet evidence covers BTC/SOL, 5m/15m/1h and both sides across the combined
   matrix.
10. The reviewed candidate is published to the handoff remote/tag only after
    all required gates pass.
11. Enabled empty-market bootstrap can be the first signed trade only at exact
    zero/zero real pools; disabled, one-sided, tied-reference and below-threshold
    paths cannot use the exception.

## Risks

- Polymarket top-of-book probability may not be executable for larger size.
- Projected Winning Payout changes with subsequent market participation.
- Network, wallet and indexing latency can consume a late-entry safety buffer.
- Different venue mechanics mean relative value is a reference signal, not
  risk-free arbitrage.
- An API timing field that is stale or belongs to another policy version can
  cause an unsafe boundary decision and must fail closed.

## Done Done

Done Done requires the upstream API timing contract deployed to devnet; SDK
parsing and public types; both strategies and every configuration consumer;
success/alternative/error/recovery tests; two-cycle CLI composition and restart
evidence; signed micro-size devnet matrix evidence; concise README/configuration
updates; no conflicting old terminology; a clean repository; and publication
of the exact reviewed commit or immutable tag. Contract and mainnet changes are
explicitly out of scope.
