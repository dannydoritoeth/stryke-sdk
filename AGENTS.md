# External SDK repository boundary

This repository is authoritative for the public developer SDK, reference bot,
developer documentation, package publishing, and repository-local tests. Keep
the public surface focused on immediate paper trading and the smallest safe
delta to live trading. Do not retain internal plans, dated audits, operational
history, or release narratives in public documentation.

Before changing files, report the current repository path, Git remote, working
tree status, upstream publication/divergence state, and intended scope. Resolve
ambiguous terms such as "SDK repo", "bot SDK", or "reference bot" before
editing. If the requested repository has not been explicitly identified, stop
and ask.

Do not copy, merge, import, or depend on implementation from other repositories
unless an explicit repository-local requirement authorizes it. Any intentional
port must identify the source concept without adding a repository dependency,
receive review, and pass this repository's full boundary, consumer, SDK, bot,
  documentation, and relevant live-runtime gates.

The reference bot may access Stryke only through `@stryketrade/sdk`. Packages must
not use workspace-external paths, local file dependencies, unpublished private
packages, or absolute filesystem paths. Detailed internal plans, credentials,
private operations, and results from other repositories do not belong here.

Completion reports must name this repository's commit SHA and the exact
commands/results produced from it. Releases must use an immutable reviewed
commit or tag, not an unidentified moving branch.

## Completion checks

Do not mark a loop, repeated workflow, CLI, worker, or ordered lifecycle
complete because its helpers exist or unit tests pass. Completion requires:

- the actual public runtime/composition entrypoint;
- an integration test exercising the required steps in order;
- at least two observed iterations for a loop, plus restart behavior where the
  requirement promises restart safety;
- every documented configuration control traced from env/file/CLI input,
  through validation, to the runtime branch or calculation it governs; and
- results produced from this repository and the exact reviewed commit.

SDK primitives, direct harness calls, test names, commit messages, documentation
claims, and results from another executable or repository prove only their own
surface. They cannot satisfy reference-bot runtime requirements. Any missing
composition or configuration cell keeps the requirement and release status
open.
