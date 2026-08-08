# Immutable SDK and reference-bot artifact handoff

The SDK and reference bot are independently installable public packages. A
consumer does not need this repository at runtime and does not need any other
Stryke repository. The reference bot accesses Stryke only through
`@stryke/sdk`.

## Build a reviewed candidate

Start from the exact reviewed commit with a clean working tree:

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run artifact:pack
```

`artifact:pack` refuses a dirty tree. It creates a new directory below
`artifacts/release/` containing:

- `stryke-sdk-<version>.tgz`;
- `stryke-reference-bot-<version>.tgz`; and
- `manifest.json` using schema `stryke.releaseArtifacts.v1`.

The manifest records the full Git commit, package versions and filenames,
byte sizes, hexadecimal SHA-512 digests, npm integrity values, and clean-room
verification results. The command installs both tarballs in a temporary project
and executes the packed reference bot for two ticks before reporting success.
It deletes incomplete output on failure and never overwrites an existing output
directory.

## Verify the handoff

Confirm that the checked-out commit is the manifest commit and independently
check each tarball digest:

```bash
git rev-parse HEAD
sha512sum artifacts/release/<candidate>/stryke-sdk-*.tgz
sha512sum artifacts/release/<candidate>/stryke-reference-bot-*.tgz
```

The results must exactly equal `manifest.json`. A moving branch name, an
unverified filename, or a tarball rebuilt from another commit is not an
immutable handoff.

## Install without the repository

Copy the two verified tarballs to an empty consumer project, then install both
artifacts together:

```bash
npm install ./stryke-sdk-0.1.0.tgz ./stryke-reference-bot-0.1.0.tgz
npx stryke-reference-bot
```

With no profile argument the binary runs its deterministic two-tick smoke and
does not load a wallet. For a configured paper run use:

```bash
npx stryke-reference-bot --profile=paper --ticks=2
```

Use the public configuration guide for devnet or live profiles. File state is
the default. Any operator can select the same optional Postgres checkpoint,
round-state, and singleton-lease adapter; there is no deployment-only fork.

## Deploy and later extract

Build once and start `node_modules/.bin/stryke-reference-bot`; do not compile on
every process restart. Keep the bot in its own process with its own environment,
signals, health reporting, and wallet access even when it shares a host with
another service.

To move it later, install the same verified tarballs in the new service, bind
the same external state and public wallet identity, keep the new process unable
to acquire the lease, stop and reconcile the old process, then transfer lease
eligibility. Never permit both processes to trade without proving exclusive
lease ownership.

Artifact verification does not authorize funding or live trading. Those remain
separate operator decisions.
