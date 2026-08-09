# @stryketrade/sdk

Typed infrastructure for Stryke bot developers.

Published as `@stryketrade/sdk`. Node.js 22 or newer is required.

## Start

From an empty project:

```bash
npm init -y
npm install @stryketrade/sdk
```

Connect to the mainnet API, select one canonical market, and
request an executable quote:

```ts
import { MarketsClient, QuotesClient, StrykeClient } from "@stryketrade/sdk";

const client = await StrykeClient.connect({
  apiBaseUrl: process.env.STRYKE_API_BASE_URL ?? "https://api.stryketrade.com",
});
const market = await new MarketsClient(client).current("BTC", "five_minute");
const quote = await new QuotesClient(client).get({
  market,
  action: "buy",
  side: "yes",
  amount: "10000", // API-authoritative minimum at time of writing
  maximumSlippageBps: 100,
});
```

`market.intervalLifecycle` is the authoritative interval state. Only `active`
and `closing` markets may be quoted or prepared; `upcoming`, `locked`, and
`closed` fail locally with `quote_blocked` before an API request. Refresh the
market list before retrying.

`market.reference` contains the immutable opening target and its provenance:

- `aligned`: the target is linked to the matching Polymarket round;
- `native`: the one-minute target is Stryke's own opening reference; and
- `degraded`: Polymarket was unavailable at open and Stryke locked its documented
  fallback target. Check `fallbackReason`.

Strategies that compare venues must require `aligned`; do not treat `degraded`
as a Polymarket observation. Enabled market symbols are advertised by
`client.capabilities.assets`, so `MarketsClient` can accept newly configured
assets without an SDK release. A missing symbol is rejected before discovery.

Inspect `quote.closingProtection.phase` and `effectiveFeeBps`. `closing` quotes
remain executable at the returned fee. `locked` and `expired` are returned as
non-retryable `quote_blocked` errors; missing or unknown policy fields fail
closed as incompatible API data.

Successful quotes are accepted only for the SDK's supported `programId` and
`mathVersion`. Use `normalizedSideProbabilityBps` for market/strategy
comparisons and `averageExecutionPriceBps` for the sized trade. Canonical
`grossAmount`, `feeAmount`, `netAmount`, `sharesIn`, `sharesOut`, and post-trade
side state remain integer strings so no precision is lost.

To exit a position, pass the exact raw side balance to `sellAvailable`. It
either returns a quote for that entire balance or throws a typed error; it never
silently reduces the sell and leaves residual shares. A retryable failure may
be retried on a later loop tick with a freshly read balance and market.

Use the returned `market` and `quote` unchanged with `TransactionsClient`.
Simulate before wallet approval, then submit, confirm, and reconcile the same
stable action ID. Use `PositionsClient` and its API-authoritative terminal
action to claim or refund; do not infer settlement locally.

There are two distinct non-winning recovery operations. When the API marks a
position `refundable` with a positive authoritative amount and a valid
underfunded or zero-winner reason/deadline, `terminalActionFor(position)`
returns `refund`; prepare it with `TransactionsClient.prepareTerminal`. The SDK
never infers collateral refund eligibility from market conditions.

After economic exposure is zero, a wallet-owned position account can separately
expose `cleanup_available`. Check `positionCleanupAvailable(position)`, then call
`new CleanupClient(client, rpc).prepareAll(owner, "SOL")`. Review and execute
each returned transaction through the same dedicated owner signer. The client
accepts only `close_user_position` instructions from the compatible program and
requires signer, fee payer, rent recipient, and requested owner to agree.

The cleanup plan reports recoverable position rent and estimated network fees
separately. It does not describe shared market-series or strike-market
initialization rent as wallet-recoverable.
`positionCleanupAvailable` enforces both the API-authored
`staleCleanup.status === "eligible"` and `cleanupEligibleAt`; do not infer
eligibility from zero shares, a UI label, or `forceClose.status`. The dedicated
cleanup status is authoritative for the program's stale zero-share close path.
Each materialized transaction retains the authoritative cleanup item and market
identity for its chunk so a consumer can match the chosen position rather than
blindly executing the first `close_all` chunk.

For the fastest safe introduction, install and run the reference bot:

```bash
npm install @stryketrade/reference-bot
npx stryke-reference-bot doctor --profile=paper
npx stryke-reference-bot --profile=paper
```

Signed execution requires a separately funded wallet adapter plus every
explicit live gate. Mainnet is the default; devnet remains compatible when the
API advertises `cluster: "devnet"`. Private keys never belong
in SDK configuration or logs.

## Typed errors

All public SDK failures use `StrykeSdkError` and one of these stable codes:

- configuration and compatibility: `configuration`, `compatibility`,
  `validation`, `unsupported_asset`, `unsupported_expiry`, `api_response`;
- read and quote: `source_unavailable`, `source_stale`, `quote_blocked`;
- transaction and wallet: `intent_mismatch`, `wallet_rejected`,
  `simulation_failed`, `submission_failed`, `confirmation_timeout`,
  `confirmation_unknown`, `blockhash_expired`, `duplicate_action`; and
- position and resolution: `position_state`, `claim_state`.

`retryable` distinguishes transient failures. Error context is deliberately
bounded and strips credentials, API keys, signatures, signed transactions, and
raw payloads.

Market and position lifecycle evidence uses
`stryke.pilotLifecycle.v1`. Normalized state is always accompanied by the raw
status, raw reason, observation timestamp, and optional observed slot.

For the complete paper-to-live quickstart, configuration, and error recovery,
see <https://github.com/dannydoritoeth/stryke-sdk>.
