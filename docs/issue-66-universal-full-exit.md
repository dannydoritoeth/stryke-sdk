# Issue 66 - Universal Full Exit SDK And Reference Bot

Status: Phase 4 in progress
Last updated: 2026-07-29

## Objective

The public SDK and reference bot must consume the Minimal-Pyth independent
curve quote contract without recreating its economics. Before trading locks,
every valid non-dust open side exposure is quoted and submitted at its exact
owned share balance. Stop loss, take profit, strategy exit, and manual SDK exit
must not silently reduce the amount or leave residual exposure.

## Repository-local requirements

| ID | Requirement | Implementation surface | Verification |
| --- | --- | --- | --- |
| UBC-S01 | Quotes expose and validate `programId=GmXBVbwqBhjetu9VSbFoQQMHDi22WAMBn4oNwj9sjnSE` and `mathVersion=independent_curve_v1`. | `packages/sdk/src/quotes.ts` | Valid, missing, wrong-program, and wrong-math tests. |
| UBC-S02 | Executable quotes distinguish normalized display probability from sized average execution price and expose canonical gross, fee, net, shares, and post-trade side state. | Quote public type/parser/README | Buy/sell contract tests with price impact. |
| UBC-S03 | `sellAvailable` requests the exact raw owned balance once. An unavailable full quote fails explicitly; it never retries a smaller percentage. | `QuotesClient.sellAvailable` | Exact request, unavailable, locked, and recovery tests. |
| UBC-S04 | Transaction preparation preserves quote identity, amount, math version, and slippage output. | SDK transaction client | Preparation parity and mismatch tests. |
| UBC-S05 | Reference-bot evaluation and execution use the same exact full-balance quote for stop loss, take profit, EV/convergence exit, and submitted sell. | `sdk-runtime.ts`, `bot.ts` | Ordered composed runtime tests for YES/NO and each exit reason. |
| UBC-S06 | Quote unavailability produces a safe decision-unavailable/hold outcome and a later authoritative quote recovers on the next tick. | Reference-bot loop | Two-tick error/recovery test and restart test. |
| UBC-S07 | Current sell value is the executable net full-exit quote; if-win payout remains the separate pari-mutuel projection. | SDK docs and bot decisions | Unequal-pool tests ensure neither substitutes for the other. |

## Path matrix

| Path | Cases | Expected result |
| --- | --- | --- |
| Success | YES/NO; partial market state; stop loss, take profit, EV and convergence exits | One full-balance quote is used through submission; no residual shares are intentional. |
| Alternative | Zero, normal and closing fees; price impact; user owns either side; 1m/5m/15m/1h | Canonical net and sized execution fields reach the strategy; configuration does not alter full-exit amount. |
| Error | Missing/mismatched identity; stale/expired quote; lock; malformed economics; full quote unavailable | Fail closed with typed SDK error; no smaller sell or wrong-math transaction is prepared. |
| Recovery | Fresh correct quote after unavailable/stale response; restart with pending confirmed sell | Next tick can execute the full balance; checkpoint reconciliation prevents duplicate submission. |

## Pseudocode

```text
parse_quote(response):
  require response.programId == supported_program
  require response.mathVersion == independent_curve_v1
  validate gross, fee, net, shares, sized average price, post-state
  require action output and minimumOutput are consistent

sell_available(position):
  require ownedShares > 0
  return sell(amount = ownedShares)
  // no percentage fallback

evaluate_and_exit(position):
  exposure = exact side exposure from portfolio
  quote = sell_available(exposure.shares)
  decision = stop_loss | take_profit | strategy_hold_or_exit
  if exit:
    prepare_and_execute(the same quote)
```

## Done Done gate

Phase 4 is done done only when:

1. public exports, SDK tests, external-consumer tests, docs contracts, and
   repository-boundary checks pass;
2. the actual reference-bot composition entrypoint proves at least two ticks,
   exact full exits for all configured exit reasons, safe quote recovery, and
   restart/checkpoint behavior;
3. every documented relevant configuration control reaches its final runtime
   consumer and `scripts/check-config-controls.mjs` passes;
4. concise SDK/reference-bot onboarding explains the quote identity, full-exit
   guarantee, Current Value versus Winning Payout, and typed failure behavior;
5. repository-local devnet evidence is rerun against an API deployment serving
   `independent_curve_v1`; if unavailable, implementation may be complete but
   Phase 4 remains awaiting that external deployment gate; and
6. the exact candidate commit, commands, results, and any external gate are
   recorded here before handoff.

