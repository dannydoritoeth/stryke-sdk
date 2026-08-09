# PRD 02 Implementation Plan: Clean-Install Trading Readiness

Status: In progress; Phases 1 and the first durable-paper slice are implemented

Linked PRD: [02-clean-install-trading-readiness.md](02-clean-install-trading-readiness.md)

## Working backward from the launch state

The launch state is an immutable release for which a context-free developer can
install public packages, operate a durable paper trader, and reach live-ready
preflight by adding only a wallet and funds. The plan works backward from that
state so implementation activity cannot be mistaken for product completion.

```text
immutable published release
  <- independent clean-room proof
    <- live doctor ready with wallet and funding
      <- complete restart-safe paper lifecycle
        <- durable simulated execution
          <- truthful doctor and market-wait UX
            <- installable public packages and stable CLI
```

## Current baseline

Baseline commit: `7ee7688292a00a29f891b70f7b4eb3634adba4fb` (`npm-v0.1.0`)

Established:

- clean repository install, build, typecheck, consumer and boundary checks;
- public `@stryketrade/sdk@0.1.0` and
  `@stryketrade/reference-bot@0.1.0` registry installation;
- public paper CLI reaches production API, market and Pyth inputs;
- API and default configuration agree on a 10,000-lamport minimum;
- two bounded public-runtime ticks execute without wallet access; and
- paper and live doctors return stable readiness states;
- paper mode persists a simulated entry, resumes it after restart, and follows
  authoritative resolution without loading a signer or submitting; and
- live doctor fails safely with actionable setup remediation when unconfigured.

Open:

- production observation has not yet captured a naturally eligible simulated
  entry and terminal lifecycle;
- paper reset/export controls and shared Postgres paper state remain open;
- live readiness still requires manual configuration knowledge; and
- no immutable release has complete clean-room outcome evidence.

## Phase 1: Stable installation and readiness contract

Targets: `OUT-01`, `OUT-02`, `OUT-05`, `OUT-10`; `READY-01`, `READY-02`,
`READY-06`, `READY-07`.

Deliverables:

1. Define stable JSON schemas and exit codes for `READY_FOR_PAPER`,
   `WAITING_FOR_MARKET`, `READY_FOR_LIVE` and `BLOCKED`.
2. Add `doctor --profile=paper|live` to the installed bot binary.
3. Validate API compatibility, current market, authoritative minimum, Pyth,
   reference alignment, strategy timing and matched minimum-size quotes.
4. Report the next eligible time and keep setup failures distinct from normal
   market waiting.
5. Prove the scoped package/binary names from an empty external consumer.

Gate: a clean external install invokes doctor and receives the correct terminal
state for ready, waiting and malformed configurations.

## Phase 2: Real paper execution

Targets: `OUT-03`, `OUT-04`, `OUT-06`; `READY-03`, `READY-04`, `READY-05`,
`READY-08`.

Deliverables:

1. Add a paper execution adapter behind the existing runtime contract.
2. Persist a versioned paper ledger containing simulated cash, positions,
   actions, quote identity, assumed fill and settlement state.
3. Use the same selected market, paired quotes, size, strategy decision and
   lifecycle inputs as live mode.
4. Emit explicit `paper_buy`, `paper_hold`, `paper_sell`, `paper_claim`,
   `paper_refund` and `paper_complete` events.
5. Ensure paper read-only enforcement is independent of the live kill switch;
   no paper code path may load a signer or submit.
6. Document simulation assumptions and reset/export controls.

Gate: the public paper CLI completes a simulated lifecycle against production
read data, with the configured and authoritative 10,000-lamport minimum traced
through both quotes and the paper fill.

## Phase 3: Restart and recovery

Targets: `OUT-09`, `OUT-10`; `READY-06`, `READY-11`.

Deliverables:

1. Reconcile paper ledger/checkpoint state before each new decision.
2. Prove restart after selection, simulated submission and open position.
3. Exercise API, Pyth, reference and quote interruptions with bounded recovery.
4. Preserve one-entry-per-round and one-economic-action-per-tick guarantees.
5. Add migration/fail-closed behavior for unknown ledger versions.

Gate: public-entrypoint integration evidence shows restart without duplicate
entry, loss of state or unsafe fallback.

## Phase 4: Minimal live transition

Targets: `OUT-07`, `OUT-08`; `READY-09`, `READY-10`.

Deliverables:

1. Add a minimal configuration generator or documented command that changes
   only wallet path/adapter, funding and explicit live approval from paper.
2. Make live doctor validate wallet format, address, mainnet RPC, minimum trade
   plus execution buffer, restart-state writability and all read/quote inputs.
3. Print a redacted effective-config diff between paper and live profiles.
4. Provide an unfunded-wallet rehearsal and a minimally funded readiness run;
   neither may submit.
5. Keep advanced controls available without making them prerequisites for the
   conservative path.

Gate: an independent user who completed paper setup reaches
`READY_FOR_LIVE` with only the documented wallet/funding additions and zero
undocumented assistance.

## Phase 5: Publication and clean-room release

Targets: `OUT-11`; `READY-01`, `READY-11`, `READY-12`.

Deliverables:

1. Publish compatible immutable SDK and bot versions.
2. Run package, consumer, SDK, bot, documentation, configuration, boundary and
   security gates from the exact release candidate.
3. Run a production-backed paper observation long enough to include two
   eligible rounds and one complete simulated lifecycle.
4. Run restart and dependency-recovery scenarios through the installed binary.
5. Conduct a context-free clean-room session and record commands, elapsed time,
   interventions and outcomes.
6. Tag the reviewed commit and record versions, digests and evidence paths.

Gate: every PRD release-gate cell is green for the same commit and package
versions. Otherwise the release status remains open.

## Required test topology

| Layer | Required proof |
| --- | --- |
| Unit | Doctor classification, paper fill rules, ledger transitions, config boundaries. |
| SDK contract | Market minimum, reference identity, quote pairing, lifecycle and compatibility parsing. |
| Composition | Ordered reconcile -> manage -> settle -> evaluate -> simulate flow over multiple ticks. |
| Restart | File and supported shared-state backends with pending/open paper state. |
| External consumer | Fresh SDK import and installed bot invocation outside the workspace. |
| Production smoke | Public CLI sees current production inputs, matched quotes and strategy diagnostics without signing. |
| Clean room | Context-free evaluator follows public docs from immutable packages. |

## Pull-request alignment template

Every implementation PR for this objective must include:

- PRD requirements advanced: `OUT-*`, `READY-*`;
- earliest release-gate cell closed;
- public runtime/composition entrypoint affected;
- configuration controls added or changed and their final consumers;
- success, wait, failure and restart evidence;
- exact candidate commit and commands/results; and
- remaining open cells that prevent Done Done.

## Sequencing rule

Do not begin Phase 4 convenience work while Phase 1 or Phase 2 prevents a clean
user from seeing real paper behavior, except for a safety/correctness fix or an
upstream dependency that can proceed independently. Do not publish readiness
claims before Phase 5 evidence exists.
