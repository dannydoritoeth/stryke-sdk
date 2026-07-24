# Quickstart

Use Node.js 22+. BTC five-minute devnet is the canonical onboarding path. BTC
and SOL 1m/5m/15m/1h are supported. One-minute live strategy performance is experimental because timing races are tighter.

## 1. Prove the safe boundary

```bash
npm ci
npm run start:read-only -w @stryke/reference-bot
```

The output contains a fixture dry-run decision and the SDK/API/program
compatibility fields `sdkVersion`, `apiVersion`, `apiSchemaVersion`, `programId`,
and `programVersion`. It contacts no endpoint and loads no wallet.

## 2. Observe real data

Run the root README's `start:live-data` command with the supplied invited API.
It uses actual SDK market, Pyth, and quote clients. `--once` evaluates once;
without it the loop repeats at `STRYKE_TICK_INTERVAL_MS`. Both modes remain
read-only and never load a wallet.

Unavailable/stale data blocks decisions. There is no alternate-price or
inferred-market fallback.

## 3. Choose or replace the estimator

`distance_to_strike` and `distance_momentum` are bundled educational baselines.
Select one with `STRYKE_ESTIMATOR`. To supply your own signal, replace the
exported `estimateFairProbability` seam in
`examples/reference-bot/src/strategy.ts`. Its input is:

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

Return a finite probability from `0` to `1`. No included estimator makes an
accuracy or profitability claim.

## 4. Understand the loop

Every tick reconciles a saved action before doing anything else. A submitted or
unknown action blocks duplicates. The bot then handles one stable position:

- sellable: request a fresh full-position quote, calculate integer PnL from the
  API-authored side cost basis, apply stop loss/take profit, then EV fallback;
- awaiting resolution: wait; or
- claimable/refundable: use only the API-authoritative terminal action.

Only after prior work is economically complete does it evaluate the next
current market. Entry needs estimator edge plus every freshness, impact, time,
size, position, exposure, checkpoint, mode, and kill-switch check. Every outcome
prints a reason.

## 5. Deliberately open live mode

Copy `.env.example`, set every control explicitly, provide the invited devnet
API/RPC and a separately funded wallet adapter, then use the root README's
minimum-size command. It does not force a trade.

The wallet module must default-export an `@solana/kit` `TransactionSigner`.
Keep wallet files outside the repository. Never put wallet secrets or signed
transactions in environment variables or logs.

Before approval, review cluster, owner, market, side, amount, quote economics,
minimum output, and blockhash. If an action is submitted/unknown, keep the same
checkpoint and action ID; the next run reconciles before any new action. The
same loop handles sell, claim/refund, and subsequent markets—do not start a
separate settlement command.
