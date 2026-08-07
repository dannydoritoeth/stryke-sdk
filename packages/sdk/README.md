# @stryke/sdk

Typed infrastructure for Stryke bot developers.

The package is consumed from this repository during the pilot and is not yet
published to npm. Node.js 22 or newer is required.

## Start

From the repository root:

```bash
npm ci
npm run build -w @stryke/sdk
```

Connect to the mainnet API, select one canonical market, and
request an executable quote:

```ts
import { MarketsClient, QuotesClient, StrykeClient } from "@stryke/sdk";

const client = await StrykeClient.connect({
  apiBaseUrl: process.env.STRYKE_API_BASE_URL ?? "https://api.stryketrade.com",
});
const market = await new MarketsClient(client).current("BTC", "five_minute");
const quote = await new QuotesClient(client).get({
  market,
  action: "buy",
  side: "yes",
  amount: "1000000", // collateral base units
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

For the fastest safe introduction, run the bundled read-only bot:

```bash
cp .env.example .env
npm run start:paper -w @stryke/reference-bot
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

See the workspace [quickstart](../../docs/quickstart.md) and
[typed-error recovery guide](../../docs/troubleshooting.md) for the complete
transaction flow, configuration and recovery preconditions.
