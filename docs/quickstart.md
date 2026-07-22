# Quickstart

The canonical onboarding flow will use a BTC five-minute market on devnet.
Until the remaining SDK modules land, install, build, and run the compatibility
tests with:

```bash
npm ci
npm run build
npm test
```

Live trading remains unavailable by default. One-minute markets are supported
by the target contract matrix but live strategy performance is experimental.
