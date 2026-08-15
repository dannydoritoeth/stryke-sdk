# Market Mechanics

## Exact market and time

A market identity includes asset/token mint, source, collateral mint, expiry
family, expiry timestamp, and the on-chain `target_value` exposed by the SDK as
`strikePrice`. The strike is not assumed to be a period opening price.

Solana Clock is authoritative for instruction timing. Local wall time is only a
scheduling aid. Trading closes at `expiry_ts`; one-minute automation needs an
extra drift margin and remains experimentally labelled.

## Pyth and resolution

Pyth supplies the estimator's configured BTC/USD or SOL/USD current price and
bounded history. Missing, stale, wrong-feed, or unverified data blocks the bot;
there is no fallback source. A locally observed Pyth price never marks a Stryke
market or position resolved.

The frozen production release at source commit
`9f8df797c404fff7a965fc462d88d9bfb10b9900` uses the first verified update
crossing expiry:
`prev_publish_time < expiry_ts <= publish_time`, no later than
`expiry_ts + 300`. Feed identity and verification must match. YES wins only when
the normalized resolved value is strictly greater than the strike. Equality
resolves NO.

## Quotes and reviewed transactions

An executable quote is bound to one exact market, action, side, amount, quote
ID, expiry, market-state version/slot, fee, price impact, and minimum output.
Quote state is not guaranteed through confirmation. Before signing, refresh if
the quote expired or market-state version changed. Before signing and again
before submission, reject an expired recent blockhash/last-valid-block-height.
Minimum output is the on-chain slippage boundary, not an estimate to discard.

Minimal-Pyth quotes also carry versioned closing protection. The closing fee is
`max(baseFeeBps, closingFeeBps)`, not their sum. Trading remains available in
`closing` at the quoted effective fee. The final hard-lock window blocks both
buy and sell; a bot holds through expiry and proceeds only with API-authored
claim/refund state.

For aligned 5m, 15m and 1h rounds, `polymarket_early` evaluates only after the
interval starts and before its early-window deadline. `polymarket_late`
evaluates during the configured window before the API-authored
`closingStartsAt`, stops at the submission buffer, and holds an entered position
through settlement. Entry compares each Polymarket ask with
`ceil(total Stryke debit / resulting Winning Payout)` and also requires positive
configured expected-return and win-profit margins. Fees and curve impact are
therefore included. Missing alignment, prices, timing or payout blocks entry.

When pre-fee revalidation is enabled, late entry closes earlier at the configured
revalidation lead. The remaining open-fee interval is reserved for a fresh
evaluation of the original side and position size. A changed signal exits the
full position; a confirmed signal holds. Missing or stale external data is
retried on later ticks while the interval remains open. If the interval expires
without fresh evidence, the bot records one exhausted outcome and holds
conservatively. The final submission buffer remains reserved before closing
fees begin.

A signature is evidence of submission, not confirmation. Only confirmed,
refreshed activity and position evidence completes the action.
If cleanup fails before signing or submission, its no-signature checkpoint is
cleared and may be retried by the recurring lifecycle. A checkpoint carrying a
signature remains blocked until confirmation and materialization reconcile.

## Positions, claims, refunds, and restart

The SDK preserves authoritative normalized state together with the raw API
state/reason, observation time, and slot. Claim only a `claimable` winning
position. Refund only an API-authored `refundable` underfunded or zero-winner
position. Losing, unresolved, claimed, refunded, sold, or deadline-expired
positions are not actionable. The SDK never invents a failed-resolution refund.

The atomic action checkpoint contains only `clientActionId`, intent hash,
reconciliation state, and signature when known. On restart, reconcile before
retrying. `submitted` and `unknown` block duplicate trades and terminal actions;
they are never permission to retry. Authoritative `failed` or `expired` evidence
can close the checkpoint, while `confirmed` requires refreshed activity and
position state.
