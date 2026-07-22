# Pilot Clean-Room Evidence

Status: awaiting independent invited-developer session

## Automated isolated-wallet lane

- Public devnet address: `5SJTm7genD8XY5rxGrDVSwjUZwaqYeKRmhv8UxeZiCbY`
- Initial funding: `0.1 SOL`
- Funding signature: `5UtKfueJoeDKoVqP3hWbrYVskWZ2mE5gujPghY5queRZgnaf6BchnjbmK4h4DmWyrgLFXXC3R8jyexs6W9BW9UBo`
- Secret handling: local ignored keypair file; no secret or signed bytes copied
  into this repository or logs
- Current result: BTC and SOL short/long YES and NO buy/sell cells simulated and
  confirmed under this address. Provider throttling was handled by bounded
  pacing and per-transaction evidence checkpointing
- Canonical automated BTC five-minute protocol run: completed in `185.283`
  seconds with zero interventions; buy/sell, claim, refund, and closure
  signatures are in `devnet-canonical-btc5.json`

This address may stand in for account and custody isolation. It does not stand
in for a new human's ability to complete the documentation without assistance.
The canonical run used the owning protocol harness; an invited developer still
must prove the SDK transaction-adapter composition from the pilot repository.

The automated clean install and docs-only maintainer rehearsal pass, but they do
not substitute for the required independent participant. Complete this record
without giving the participant access to another Stryke repository.

- SDK repository revision: pending
- Participant: pending
- Start/end time: pending
- Funded devnet pilot wallet prerequisite: pending
- Commands used: pending
- BTC five-minute trade signature: pending
- Reconciled position evidence: pending
- Claim or refund signature: pending
- Documented failure exercised: pending
- Undocumented maintainer assistance count: pending (required: zero)

The retained authoritative minimal-Pyth matrix is recorded in
`devnet-lifecycle-matrix.json`; it proves finalized claim/refund/closure evidence
for all eight asset/expiry cells but does not satisfy the independent onboarding,
fresh sell-coverage, restart, or failure-recovery gates.
