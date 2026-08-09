# External SDK repository boundary

This repository is authoritative for the developer SDK, reference bot, public
developer documentation, handoff package, and repository-local release
evidence.

The product objective and working-backwards delivery order are defined in
`docs/prds/02-clean-install-trading-readiness.md` and its linked implementation
plan. Work affecting installation, onboarding, paper mode, live readiness,
configuration, packaging, documentation, or release evidence must name the
`OUT-*` and `READY-*` requirements it advances and the earliest release-gate
cell it closes. Do not prioritize convenience work over an earlier open outcome
unless it fixes safety/correctness or unblocks an independent dependency.

Before changing files, report the current repository path, Git remote, working
tree status, upstream publication/divergence state, and intended scope. Resolve
ambiguous terms such as "SDK repo", "bot SDK", or "reference bot" before
editing. If the requested repository has not been explicitly identified, stop
and ask.

Do not copy, merge, import, or depend on implementation from other repositories
unless an explicit repository-local requirement authorizes it. Any intentional
port must identify the source concept without adding a repository dependency,
receive review, and pass this repository's full boundary, consumer, SDK, bot,
documentation, and relevant live-evidence gates.

The reference bot may access Stryke only through `@stryketrade/sdk`. Packages must
not use workspace-external paths, local file dependencies, unpublished private
packages, or absolute filesystem paths. Detailed internal plans, credentials,
private operations, and evidence from other repositories do not belong here.

Keep evidence repository-specific. Completion reports must name this
repository's commit SHA and the exact commands/results produced from it.
Developer handoff must use an immutable reviewed commit or tag, not an
unidentified moving branch.

## Completion evidence

Do not mark a loop, repeated workflow, CLI, worker, or ordered lifecycle
complete because its helpers exist or unit tests pass. Completion requires:

- the actual public runtime/composition entrypoint;
- an integration test exercising the required steps in order;
- at least two observed iterations for a loop, plus restart behavior where the
  requirement promises restart safety;
- every documented configuration control traced from env/file/CLI input,
  through validation, to the runtime branch or calculation it governs; and
- evidence produced from this repository and the exact candidate commit.

SDK primitives, direct harness calls, test names, commit messages, documentation
claims, and evidence from another executable or repository prove only their own
surface. They cannot satisfy reference-bot runtime requirements. Any missing
composition or configuration cell keeps the requirement and release status
open.
