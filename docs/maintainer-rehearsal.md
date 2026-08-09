# Maintainer Docs-Only Rehearsal

Date: 2026-07-22

The rehearsal used a clean temporary copy with no `.git`, `node_modules`, or
compiled `dist` directories. The maintainer followed only the README commands.

- Start: `2026-07-22T09:27:33Z`
- End: `2026-07-22T09:27:40Z`
- Commands: `npm ci`, `npm run start:read-only -w @stryketrade/reference-bot`, then
  `npm run start:live -w @stryketrade/reference-bot` without live environment gates
- Read-only result: exit `0`, visible `dry_run` BTC five-minute decision and
  SDK/API/schema/program compatibility output, with no wallet
- Live-default result: exit `1`, typed `configuration` refusal because all live
  gates were not enabled
- Blockers: none
- Undocumented hints required: none

An earlier clean-copy attempt revealed that the example start scripts built the
reference package without first building its workspace SDK dependency. The
scripts were corrected to build `@stryketrade/sdk` explicitly before this successful
rehearsal; the contract test now executes the same commands.
