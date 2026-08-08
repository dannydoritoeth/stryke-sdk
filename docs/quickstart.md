# Quickstart

Use Node.js 22+. BTC five-minute mainnet is the canonical onboarding path. BTC
and SOL 1m/5m/15m/1h are supported. One-minute live strategy performance is experimental because timing races are tighter.

## 1. Copy and inspect the safe configuration

```bash
npm ci
cp .env.example .env
npm run start:paper -w @stryke/reference-bot
```

The example config uses `https://api.stryketrade.com`. Paper mode uses real data and prints the
SDK/API/program compatibility fields `sdkVersion`, `apiVersion`,
`apiSchemaVersion`, `programId`, and `programVersion`. It never loads a wallet
or submits.

## 2. Create and fund a dedicated trading wallet

Install the Solana CLI, then create a new dedicated wallet outside this
repository:

```bash
solana-keygen new --outfile ../stryke-trading-wallet.json
solana-keygen pubkey ../stryke-trading-wallet.json
```

The JSON file contains the wallet's private key material. Anyone with it can
control the wallet: never commit, share, or use it as a personal wallet. Fund
the printed address with only the mainnet SOL you intend to risk, then set its path in `.env`:

```env
STRYKE_WALLET_ADAPTER_PATH=./examples/reference-bot/wallet-adapter.example.mjs
STRYKE_WALLET_KEYPAIR_PATH=../stryke-trading-wallet.json
```

## 3. Make minimum-size mainnet trades

Configure the separately funded wallet adapter in `.env`, inspect every value,
then run `npm run start:live -w @stryke/reference-bot`. It uses the same
continuous loop with signed mainnet transactions. A trade occurs only when the
estimator and all safety checks pass.

The example currently uses 0.014 SOL, but the bot does not treat that value as
permanent. It reads the authoritative minimum for each market and fails closed
before quoting when the configured size is too small or the minimum is absent.
The example permits three unresolved positions so consecutive five-minute
rounds can overlap, while durable round state still permits only one entry per
market identity.

Unavailable/stale data blocks decisions. There is no alternate-price or
inferred-market fallback.

## 4. Choose or replace the estimator

`volatility_adjusted_probability` is the recommended generic baseline. It uses
timestamped Pyth log returns, exact time remaining and strike distance, then
compares both sides with matched executable quotes. It needs the configured
history window to fill before it can trade; until then decisions fail closed as
`model_inputs_unavailable`.

`distance_to_strike` and `distance_momentum` remain educational examples, not
credible probability or profitability claims. Select an estimator with
`STRYKE_ESTIMATOR`. To supply your own signal, replace the
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

## 5. Understand the loop

Every tick reconciles a saved action before doing anything else. A submitted or
unknown action blocks duplicates. The bot then handles one stable position:

- sellable: request a fresh quote for the exact raw side balance, calculate
  integer PnL from API-authored side cost basis, apply stop loss/take profit,
  then compare executable net proceeds with the API-authored principal-backed
  Winning Payout. The SDK never substitutes a smaller exit or recomputes payout
  from pool totals;
- awaiting resolution: wait; or
- claimable/refundable: use only the API-authoritative terminal action.

Every actionable open position is evaluated each tick, although the MVP opens
only one economically active position at a time and submits at most one
transaction per tick. Only after prior work is economically complete does it
evaluate the next current market. Entry needs matched YES/NO executable quotes,
the higher model edge, buffered fee-free real-pool capacity, open closing state,
and every freshness, impact, time, size, exposure, checkpoint, mode and
kill-switch check. Every outcome prints a reason.

## 6. Review before signing

The wallet module must default-export an `@solana/kit` `TransactionSigner`.
Keep wallet files outside the repository. Never put wallet secrets or signed
transactions in environment variables or logs.

Before signing, review cluster, owner, market, side, amount, quote economics,
minimum output, and blockhash. If an action is submitted/unknown, keep the same
checkpoint and action ID; the next run reconciles before any new action. The
same loop handles sell, claim/refund, and subsequent markets—do not start a
separate settlement command.
