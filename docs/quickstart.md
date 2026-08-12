# Quickstart

Use Node.js 22+. BTC five-minute markets are the canonical onboarding path.
BTC and SOL 1m/5m/15m/1h are supported; one-minute live automation is
experimental because its timing window is tighter.

## Read-only MCP inspection

For anonymous market inspection and quote previews without starting a bot,
install only the SDK:

```bash
mkdir stryke-mcp && cd stryke-mcp
npm init -y
npm install @stryketrade/sdk
```

Create `inspect.mjs` using the reference flow in the
[read-only MCP guide](read-only-mcp.md), then run:

```bash
node inspect.mjs
```

No API key, OAuth token, cookie, or wallet is required. The client verifies the
exact read-only Phase A tool contract at connection time and cannot invoke
transaction or wallet operations.

## Paper trading

Create an empty project and install the public packages:

```bash
mkdir stryke-bot && cd stryke-bot
npm init -y
npm install @stryketrade/sdk @stryketrade/reference-bot
```

Check production data and start paper trading:

```bash
npx stryke-reference-bot doctor --profile=paper
npx stryke-reference-bot --profile=paper
```

Paper mode uses real Stryke markets, Pyth prices, and executable quotes, but it
never loads a wallet or submits a transaction. Simulated positions are stored
locally and resumed after restart. Add `--ticks=2` for a short two-iteration
check; otherwise the bot runs until Ctrl-C.

The bot prints `sdkVersion`, `apiVersion`, `apiSchemaVersion`, `programId`, and
`programVersion`, followed by a reason for every action, wait, or block. No
command forces a trade.

## Live trading

Install the Solana CLI and create a dedicated wallet outside the project:

```bash
solana-keygen new --outfile ../stryke-trading-wallet.json
solana-keygen pubkey ../stryke-trading-wallet.json
```

The JSON file contains private key material. Never commit or share it, and do
not use a personal wallet. Fund only the printed mainnet address with SOL you
intend to risk.

Configure the installed adapter and keypair:

```bash
export STRYKE_WALLET_ADAPTER_PATH="$PWD/node_modules/@stryketrade/reference-bot/wallet-adapter.example.mjs"
export STRYKE_WALLET_KEYPAIR_PATH="$PWD/../stryke-trading-wallet.json"
```

Verify the wallet, RPC, production market, quotes, and funding without signing:

```bash
npx stryke-reference-bot doctor --profile=live
```

Only after it reports `READY_FOR_LIVE`, start the continuous live bot:

```bash
npx stryke-reference-bot --profile=live
```

The production minimum is currently 10,000 lamports (0.00001 SOL), but the bot
reads the authoritative minimum from each market and fails closed if the
configured size is too small. Keep additional SOL for transaction fees,
position-account rent, and possible first-trader shared market initialization.

## Lifecycle and recovery

Every tick follows this order:

```text
reconcile saved action
  -> manage/exit open positions
  -> claim or refund when API-authorized
  -> close API-authorized position accounts and recover rent
  -> evaluate the next market
```

Cleanup is automatic in the continuous live command. It waits for the API's
authoritative `selfCloseAvailable` signal, signs once, and keeps its checkpoint
until the account disappears. Position-account rent is recoverable; shared
market initialization costs are not unless the production API explicitly
provides a recovery action.

To recover eligible rent without allowing a new entry:

```bash
npx stryke-reference-bot recover-rent --profile=live
```

To stop new entries while continuously finishing settlement, claim/refund and
API-authored cleanup, run:

```bash
npx stryke-reference-bot drain --profile=live
```

Treat the structured `reference_bot_drain_complete` event as the success
signal. Without it, keep the bot out of a new live-entry window.

If the wallet is below the new-entry reserve, the continuous bot still
reconciles and performs eligible recovery, then reports `insufficient_funding`
instead of entering another market.

## Configuration

No `.env` file is required for the default paper or live path. Set environment
variables only when you need an override; see [configuration](configuration.md).
The default strategy is the inspectable `baseline` strategy. All strategies
use fresh matched quotes and fail closed on unavailable or stale inputs.

For setup failures, read the first failed preflight line and follow its
`remediation`; see [troubleshooting](troubleshooting.md).
