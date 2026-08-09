# PRD 02: Clean-Install Paper And Live Trading Readiness

Status: Approved objective; implementation and release evidence incomplete

Linked implementation plan: [02-clean-install-trading-readiness-plan.md](02-clean-install-trading-readiness-plan.md)

## Objective

A developer with Node.js 22+ and no prior Stryke context can install public,
immutable packages and immediately start a safe production-backed paper trader.
After understanding its output, the same developer can enable minimum-size live
trading by adding only a dedicated wallet, limited funding, and explicit live
approval.

The product is complete only when the public commands, not repository fixtures
or direct helper calls, prove those outcomes from a clean environment.

## Finished user experience

### Paper

From an empty directory, the supported happy path is no longer than:

```bash
npm install @stryketrade/sdk @stryketrade/reference-bot
npx stryke-reference-bot doctor --profile=paper
npx stryke-reference-bot --profile=paper
```

The doctor returns one terminal state:

- `READY_FOR_PAPER`: dependencies are healthy and the bot can evaluate the
  current strategy inputs;
- `WAITING_FOR_MARKET`: setup is healthy, with the exact market condition and
  next eligible time reported; or
- `BLOCKED`: setup or compatibility is invalid, with one concrete remediation.

The paper process uses production market, oracle, reference and quote data but
never loads a wallet or submits a transaction. It maintains a durable simulated
portfolio and emits observable paper buy, monitor, exit, settlement and restart
events. Live execution controls such as the kill switch must not suppress
simulation; read-only enforcement remains absolute.

### Live

After a successful paper experience, live enablement requires only:

1. create or select a dedicated trading wallet outside the project;
2. fund it with the documented minimum plus transaction buffer;
3. provide its adapter/path through the supported secret-safe mechanism;
4. run `doctor --profile=live`; and
5. explicitly start the live profile.

The developer does not need to edit source, infer market identifiers, discover
undocumented environment variables, install from a repository checkout, or
understand all advanced controls before using conservative defaults.

## Outcome measures

| ID | Outcome | Required measure |
| --- | --- | --- |
| OUT-01 | Clean installation | Published packages install in an empty directory using only public registry metadata and lockfiles. |
| OUT-02 | Fast first result | Paper doctor returns a truthful terminal state within 60 seconds on a healthy network. |
| OUT-03 | Immediate paper operation | One documented command starts a continuous, production-backed simulator without credentials. |
| OUT-04 | Observable paper lifecycle | Release evidence contains at least two simulated entries across eligible rounds and at least one complete buy-to-exit-or-terminal lifecycle. |
| OUT-05 | Honest waiting | Ineligible, degraded or unaligned markets report why and when to retry; they are not presented as setup failures or successful trading evidence. |
| OUT-06 | Minimum-size consistency | API-authoritative minimum, default trade size, per-trade cap, quote amount and simulated/live transaction amount agree at runtime. |
| OUT-07 | Minimal live delta | After paper success, only wallet custody, funding and explicit live approval are new mandatory inputs. |
| OUT-08 | Live readiness proof | Live doctor validates API, market, oracle/history, reference, matched quotes, RPC cluster, wallet identity, funding and writable restart state without submitting. |
| OUT-09 | Safe restart | Paper and live profiles reconcile durable state before making another economic decision; restart cannot duplicate an action or round entry. |
| OUT-10 | Actionable diagnostics | Every wait, skip, block and action names its phase, stable reason, market identity and remediation or next eligible time where applicable. |
| OUT-11 | Immutable handoff | Clean-room and release evidence identify the exact reviewed commit/tag and published package versions. |

## Product requirements

| ID | Requirement |
| --- | --- |
| READY-01 | Publish compatible `@stryketrade/sdk` and reference-bot packages; repository-only and unidentified tarball workflows do not satisfy clean installation. |
| READY-02 | Provide paper and live `doctor` commands with stable machine-readable results and human-readable remediation. |
| READY-03 | Paper mode must use a simulated execution adapter and durable paper ledger while making wallet loading and transaction submission impossible. |
| READY-04 | Paper simulation must consume the same market selection, quote economics, strategy, sizing and safety decisions as live execution. |
| READY-05 | Paper execution must model fills only from fresh executable quotes and clearly label assumptions; it must not claim profitability or historical execution certainty. |
| READY-06 | The bot must distinguish healthy waiting from invalid setup and continue across round boundaries until stopped. |
| READY-07 | Startup must validate a current market, authoritative minimum, reference requirements and matched YES/NO quotes before declaring full strategy readiness. |
| READY-08 | The default configuration must use the API-authoritative production minimum and preserve a bounded aggregate exposure consistent with the open-position cap. |
| READY-09 | Live mode must require a dedicated signer, correct RPC cluster, sufficient balance, explicit live enablement and a disabled kill switch. |
| READY-10 | A generated or minimal configuration path must expose required choices while retaining advanced documented overrides. |
| READY-11 | Public runtime evidence must cover two eligible iterations, a complete paper lifecycle, restart during pending/open state, and recovery from a documented dependency failure. |
| READY-12 | Configuration, consumer, package, SDK, bot, documentation, boundary and production-smoke gates must pass against one candidate commit. |

## Safety invariants

- Paper mode cannot import a wallet adapter, sign, simulate through a signer, or
  submit a transaction regardless of environment configuration.
- Missing, stale, degraded, mismatched or incoherent authoritative inputs fail
  closed for that decision; the UX may wait but must not fabricate data.
- The SDK and bot never substitute a remembered minimum for a missing market
  minimum.
- Live activation is explicit and cannot be inferred from the presence of a
  wallet or funds.
- Wallet material, signed bytes and secrets never appear in configuration
  output, logs, evidence, fixtures or repository files.
- The reference bot accesses Stryke only through `@stryketrade/sdk`.
- No paper result is represented as a guaranteed live fill, return or profit.

## Scope

In scope:

- public package installation and executable discovery;
- paper simulation, durable paper state and restart behavior;
- readiness diagnostics and market-wait UX;
- minimum-size default configuration;
- dedicated-wallet live onboarding and preflight;
- clean-room, packaging and production-backed release evidence; and
- concise quickstart, troubleshooting and handoff documentation.

Out of scope:

- creating or funding wallets without explicit user action;
- custody services, hosted bot operation or secret management vendors;
- weakening strategy, quote, lifecycle or transaction safety gates;
- guaranteeing that a qualifying market or trade exists immediately;
- promising profitability; and
- implementation changes in another repository. Upstream dependencies are
  recorded as explicit contracts and remain open until deployed and observed.

## Acceptance scenarios

### A. Empty-machine paper success

An independent evaluator installs published packages, runs paper doctor, starts
the bot, observes healthy waiting if necessary, then observes two eligible
strategy decisions and a durable simulated lifecycle without assistance.

### B. Market temporarily ineligible

Doctor and runtime identify the exact condition, such as
`opening_snapshot_missing`, report the next eligible boundary when knowable,
keep retrying safely, and never call the state healthy-for-quotes until aligned
inputs exist.

### C. Restart during paper lifecycle

The process stops after a simulated buy and restarts from the same state. It
monitors or settles the existing paper position and does not create a duplicate
entry.

### D. Live readiness without execution

With a dedicated minimally funded wallet, live doctor validates the entire
read/quote/RPC/wallet/state path and exits `READY_FOR_LIVE` without signing or
submitting.

### E. Live safety failure

A missing wallet, wrong cluster, insufficient balance, active kill switch,
stale quote or incompatible market produces one precise blocker and no signing.

## Release gates

Release readiness is a matrix, not a single green test:

| Gate | Evidence required |
| --- | --- |
| Package | Fresh registry install and executable invocation outside this repository. |
| SDK consumer | Packed/published SDK imported by an external TypeScript consumer. |
| Paper runtime | Public CLI, production inputs, two eligible iterations and complete simulated lifecycle. |
| Restart | Public CLI restart from pending and open paper state without duplication. |
| Live doctor | Dedicated unfunded and minimally funded wallet cases; no submission. |
| Configuration | Every documented control traced from input through validation to its runtime consumer. |
| Boundary/security | No private dependency, external path, wallet material or secret leakage. |
| Documentation | Commands copied verbatim by a context-free evaluator with zero undocumented assistance. |
| Publication | Exact candidate commit, package versions, digests and immutable tag recorded. |

No gate can be satisfied by a helper existing, a fixture-only test, another
repository's evidence, or a run against an unidentified moving branch.

## Decision rules

Work is prioritized by the earliest unmet user outcome, in this order:

1. Can a developer install the public artifacts?
2. Can doctor distinguish ready, waiting and blocked states?
3. Can paper mode produce and persist realistic simulated actions?
4. Can the simulator demonstrate lifecycle and restart behavior?
5. Can the same configuration reach live readiness with only wallet/funding
   additions?
6. Can an independent clean-room evaluator reproduce the outcome from the
   immutable candidate?

New work must name the `OUT-*` and `READY-*` requirements it advances. Work
that does not close an acceptance or release-gate cell is secondary unless it
repairs a correctness, safety or security defect.

## Done Done

Done Done requires all outcome measures, acceptance scenarios and release gates
above against one reviewed commit and its published immutable packages. A
successful install, preflight, two skipped ticks, fixture lifecycle, SDK
primitive or wallet-boundary failure is useful evidence but is not the end
state.
