# External SDK repository boundary

This repository is authoritative for the developer SDK, reference bot, public
developer documentation, handoff package, and repository-local release
evidence.

Before changing files, report the current repository path, Git remote, working
tree status, and intended scope. Resolve ambiguous terms such as "SDK repo",
"bot SDK", or "reference bot" before editing. If the requested repository has
not been explicitly identified, stop and ask.

Do not copy, merge, import, or depend on implementation from other repositories
unless an explicit repository-local requirement authorizes it. Any intentional
port must identify the source concept without adding a repository dependency,
receive review, and pass this repository's full boundary, consumer, SDK, bot,
documentation, and relevant live-evidence gates.

The reference bot may access Stryke only through `@stryke/sdk`. Packages must
not use workspace-external paths, local file dependencies, unpublished private
packages, or absolute filesystem paths. Detailed internal plans, credentials,
private operations, and evidence from other repositories do not belong here.

Keep evidence repository-specific. Completion reports must name this
repository's commit SHA and the exact commands/results produced from it.
Developer handoff must use an immutable reviewed commit or tag, not an
unidentified moving branch.
