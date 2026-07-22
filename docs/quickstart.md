# Quickstart

Use Node.js 22 or newer. BTC five-minute on devnet is the canonical onboarding
path. BTC and SOL `one_minute`, `five_minute`, `fifteen_minute`, and `hourly`
markets are SDK-supported; one-minute live strategy performance is experimental
because expiry, oracle, and confirmation races are tighter.

## 1. Install and prove the read-only boundary

```bash
npm ci
npm run start:read-only -w @stryke/reference-bot
```

The structured output includes a dry-run decision and `stryke_compatibility`
with `sdkVersion`, `apiVersion`, `apiSchemaVersion`, `programId`, and
`programVersion`. It uses a labelled documentation fixture and does not contact
an endpoint, load a wallet, sign, or submit.

## 2. Connect to the invited devnet API

Use the supplied devnet base URL; do not guess or substitute another cluster.
The handshake fails closed unless `/v1/capabilities` matches the SDK's API
schema, minimal-Pyth profile, program ID/version, and devnet cluster.

```ts
import { MarketsClient, StrykeClient } from "@stryke/sdk";

const client = await StrykeClient.connect({
  apiBaseUrl: process.env.STRYKE_API_BASE_URL!,
});
console.log(client.capabilities);

const markets = new MarketsClient(client);
const market = await markets.current({
  asset: "BTC",
  expiryFamily: "five_minute",
});
console.log(market);
```

Unavailable or stale data blocks the decision. There is no cross-cluster,
alternate-price-source, or inferred-market fallback.

## 3. Replace the estimator

Edit only `examples/reference-bot/src/strategy.ts`. Keep the function signature:

```ts
export const estimateFairProbability = ({
  currentPrice,
  strikePrice,
  secondsRemaining,
  priceHistory,
}: {
  currentPrice: number;
  strikePrice: number;
  secondsRemaining: number;
  priceHistory: readonly { price: number; publishTime: number }[];
}): number => {
  void currentPrice;
  void strikePrice;
  void secondsRemaining;
  void priceHistory;
  return 0.5;
};
```

The result must be finite and between `0` and `1`. The bundled estimator is an
educational placeholder and makes no accuracy, profitability, or predictive
quality claim.

## 4. Interpret the decision

For YES, the bot compares `fairProbability` with the executable YES quote. For
NO, it compares `1 - fairProbability` with the executable NO quote. Entry needs
the configured minimum edge plus every freshness, impact, time, size, position,
aggregate-exposure, checkpoint, and kill-switch check. Read-only or live-off
mode records the decision without loading a wallet or submitting.

While holding, executable net sell proceeds are compared with the applicable
side probability multiplied by the API-authored if-win payout. Missing or stale
sell/payout inputs yield `decision_unavailable`. Claim/refund eligibility comes
only from refreshed Stryke position state, never from a local Pyth comparison.

## 5. Deliberately open the live gate

Copy `.env.example`, use a separately funded devnet pilot wallet, and provide a
wallet-adapter module path. Inline secrets are rejected.

```bash
STRYKE_READ_ONLY_MODE=false \
STRYKE_LIVE_TRADING_ENABLED=true \
STRYKE_KILL_SWITCH_ENABLED=false \
STRYKE_WALLET_ADAPTER_PATH=./wallet-adapter.js \
npm run start:live -w @stryke/reference-bot
```

The command fails unless all live gates pass. A production action must still use
the SDK quote, transaction, checkpoint, execution, and position clients; review
cluster, owner, exact market, side, amount, quote economics, minimum output, and
blockhash before wallet approval.

If an action becomes `submitted` or `unknown`, stop and reconcile it. Never
create a new action ID merely because confirmation is slow.
