# Test path coverage audit — SDK and reference bot

Date: 2026-07-25  
Repository: `stryke-sdk`  
Baseline: `f34dce6`

## Result

| Surface | Result | Conclusion |
| --- | --- | --- |
| SDK | Strong for the pilot trading lifecycle | Market selection, quote validity, transaction binding/execution, reconciliation, positions, claim/refund, typed failures and retry/restart behavior cover success, alternatives, errors and recovery. |
| Reference bot lifecycle | Strong | The composed runtime proves ordered reconciliation, repeated ticks, hold/sell, stop loss, take profit, expiry waiting, claim/refund, terminal-to-next-market progression and retryable-source recovery. |
| Reference bot configuration | Strong | A machine-checked 24-control register links every documented environment input to its final runtime consumer and exact test evidence. Boundaries, malformed input, conflicts, profile precedence, endpoint/file bindings, and recurring interval consumption are direct tests. |
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

## Configuration closure

`scripts/config-control-inventory.mjs` registers all 24 documented controls.
The strict checker derives the public control set from `.env.example` and the
configuration guide, requires a named final consumer, and validates each exact
test file/title reference.

Closure evidence:

1. Numeric controls test minimum, maximum, malformed, below/above-bound and
   conflict behavior independently.
2. Asset, expiry, side, estimator, amount, slippage and history size reach the
   actual SDK runtime adapter; entry and exit policy tests isolate every risk
   gate.
3. API, RPC, Hermes, checkpoint and wallet adapter inputs reach the exact CLI
   bindings used to construct their consumers. The bundled wallet adapter has
   separate unreadable/malformed keypair tests.
4. Profile precedence proves paper cannot load a wallet or submit, devnet
   requires explicit controls, the kill switch wins, and unapproved mainnet
   fails before wallet/API work.
5. The actual recurring bot entrypoint consumes the configured interval across
   three ticks. Existing restart tests reconcile checkpoints before new work.
6. Deterministic boundary/error permutations remain local; the real devnet
   matrix is reserved for environment-dependent lifecycle behavior.

## Verification run for this audit

`npm run check:config-controls && npm run typecheck && npm test`

Result on the configuration-closure candidate: 24 controls and zero open gaps;
typecheck passed; 33 files and 180 tests passed. Devnet tests were excluded by
that command; existing devnet evidence remains under `docs/evidence/` and is
not represented as a full configuration permutation matrix.
