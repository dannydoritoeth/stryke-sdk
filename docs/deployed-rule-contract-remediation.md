# Deployed Rule Contract Remediation

Status: implementation candidate

Canonical product issue: `stryke-app/docs/issues/85-deployed-minimal-pyth-rule-contract-traceability.md`.

## Scope and order

This repository consumes the public API contract. It does not change or deploy
the Solana program.

1. Parse the API's immutable deployed-release metadata and fail closed when the
   source commit, binary hash, settlement mode, 90-day force-close duration, or
   no-grace rule differs from the supported release.
2. Treat API `cleanup.selfCloseAvailable` plus same-owner `rentRecipient` as the
   wallet-close gate. Do not invent a grace timestamp or require both token
   balances to be zero; a losing-side balance may remain after resolution.
3. Continue to request API-authored transaction preparation and validate the
   returned program, signer, fee payer, rent recipient, owner, and instruction
   before signing.
4. In the reference bot, reconcile pending actions, claim/refund first, then
   close API-authorized position accounts, and only then consider a new entry.

## Pseudocode

```text
connect(api):
  capabilities = GET /v1/capabilities
  require capabilities.contract.deployedRules == supported immutable release

cleanup_available(position, owner):
  return position.cleanup.selfCloseAvailable
     and position.cleanup.rentRecipient == owner

bot_tick():
  reconcile durable checkpoint
  positions = sdk.listPositions(owner)
  if claim/refund available: prepare, validate, sign, submit, confirm
  else if cleanup_available: prepare cleanup, validate, sign, submit, confirm
  else manage existing exposure
  else evaluate entry
```

## Required proof

- SDK parser accepts immediate cleanup without `cleanupEligibleAt`.
- A resolved losing-only position with a remaining losing-side balance is
  closable when the API says it is.
- A different rent recipient or `selfCloseAvailable: false` fails closed.
- Capability drift for force close or release identity fails the handshake.
- The actual reference-bot runtime executes claim -> cleanup -> two clean
  observations over multiple iterations and preserves restart reconciliation.
- Build, typecheck, package-consumer smoke, and repository boundary checks pass.

## Release and deployment

Publish the SDK and reference bot together at one immutable version and Git
commit. The application deployment must install that exact release artifact,
then its API and embedded reference bot must be smoke-tested together.

