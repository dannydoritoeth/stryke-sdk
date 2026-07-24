# @stryke/sdk

Typed infrastructure for the private Stryke bot-developer pilot.

The package is consumed from this repository during the pilot and is not yet
published to npm. Node.js 22 or newer is required.

## Start

From the repository root:

```bash
npm ci
npm run build -w @stryke/sdk
```

Connect to the supplied invited-devnet API, select one canonical market, and
request an executable quote:

```ts
import { MarketsClient, QuotesClient, StrykeClient } from "@stryke/sdk";

const client = await StrykeClient.connect({
  apiBaseUrl: process.env.STRYKE_API_BASE_URL!,
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

Use the returned `market` and `quote` unchanged with `TransactionsClient`.
Simulate before wallet approval, then submit, confirm, and reconcile the same
stable action ID. Use `PositionsClient` and its API-authoritative terminal
action to claim or refund; do not infer settlement locally.

For the fastest safe introduction, run the bundled read-only bot:

```bash
cp .env.example .env
npm run start:paper -w @stryke/reference-bot
```

Live execution is devnet-only, disabled by default, and requires a separately
funded wallet adapter plus every explicit live gate. Private keys never belong
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
