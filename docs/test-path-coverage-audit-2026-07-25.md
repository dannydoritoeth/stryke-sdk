# Test path coverage audit — SDK and reference bot

Date: 2026-07-25  
Repository: `stryke-sdk`  
Baseline: `f34dce6`

## Result

| Surface | Result | Conclusion |
| --- | --- | --- |
| SDK | Strong for the pilot trading lifecycle | Market selection, quote validity, transaction binding/execution, reconciliation, positions, claim/refund, typed failures and retry/restart behavior cover success, alternatives, errors and recovery. |
| Reference bot lifecycle | Strong | The composed runtime proves ordered reconciliation, repeated ticks, hold/sell, stop loss, take profit, expiry waiting, claim/refund, terminal-to-next-market progression and retryable-source recovery. |
| Reference bot configuration | Partial | Parsing and policy controls are tested, but every documented environment control is not yet proven independently from `.env`/CLI ingress to its final runtime effect. |
| Devnet permutations | Strong for the baseline asset/expiry lifecycle; partial for configuration permutations | BTC/SOL across 1m/5m/15m/1h has recorded evidence. That matrix uses a baseline configuration and is not a happy/boundary/error matrix for every configurable control. |

## SDK path matrix

| Lifecycle | Success | Alternative | Error | Recovery |
| --- | --- | --- | --- | --- |
| Market selection | exact BTC/SOL expiry matrix | unique closest hourly strike and initializable market | ambiguity, identity mismatch and stale metadata fail closed | later fresh/unambiguous discovery is retryable |
| Quotes | buy and sell economics | large integer and slippage variants | expired, stale and changed-state quote blocks | fresh quote/state is required before prep |
| Transactions | prepare, simulate, submit and confirm | wallet rejection and terminal expiry states | intent mismatch, simulation/submission failure and timeout are typed | checkpoints reconcile after restart and prevent duplicate effects |
| Settlement | resolved winner claim | underfunded/zero-winner refund | loser, unresolved, completed and expired positions are not actionable | reconciliation refreshes terminal position/activity state |
| Prices | normalized bounded history | same-time replacement and reconnect | wrong-feed, future, stale and non-numeric updates reject | disconnect is unavailable; reconnect does not falsely freshen cache |

## Reference bot path matrix

| Lifecycle | Success | Alternative | Error | Recovery |
| --- | --- | --- | --- | --- |
| Entry | eligible edge buys | YES/NO side and paper decision paths | edge, impact, time, size, position, exposure, freshness and checkpoint gates block | later tick may enter after terminal/retryable state clears |
| Open position | hold then executable sell | stop loss, take profit and EV exit | stale/missing/invalid quote inputs block | next fresh tick can manage the position |
| Expiry | waits while unresolved | claim or refund based on authoritative position state | Pyth price alone cannot invent resolution | terminal completion permits the next market cycle |
| Loop/restart | two or more ticks execute in order | non-actionable history does not consume capacity | retryable source failure does not submit | next tick continues; persisted checkpoints prevent duplication |

## Configuration gap

The current all-controls parsing test supplies every environment variable but
asserts only a subset. The composed SDK runtime test also sets many controls in
one case, then an early edge gate can prevent later controls from being
observed. Therefore those tests cannot prove all controls reach their final
consumer.

Required closure work:

1. Create one inventory row for every documented environment variable.
2. For each control test default/missing, valid minimum, valid maximum where
   bounded, malformed, below/above bounds, and conflict/precedence behavior.
3. Add an isolated `.env`/CLI-to-runtime assertion for each behavior-bearing
   control: asset, expiry, side, trade size, slippage, edge, stop loss, take
   profit, timing, position cap, aggregate exposure, freshness, history size,
   estimator, tick interval, mode, cluster, wallet, kill switch, and mainnet
   approval gates.
4. Ensure each test reaches that control's final observable consumer; do not
   group controls where an earlier gate masks later ones.
5. Run the composed runtime for at least two iterations and include restart
   where persistence or reconciliation is affected.
6. Extend the devnet matrix only for controls whose behavior must be proven
   against the real environment. Keep deterministic boundary/error cases local.

## Verification run for this audit

`npm test`

Result: 33 files passed, 176 tests passed. Devnet tests were excluded by that
command; existing devnet evidence remains under `docs/evidence/` and must not be
represented as a full configuration permutation matrix.
