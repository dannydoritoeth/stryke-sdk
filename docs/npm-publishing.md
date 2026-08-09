# npm publication

`@stryketrade/sdk` and `@stryketrade/reference-bot` are public packages. They share one
version so the reference bot can depend on an exact reviewed SDK release.

## One-time namespace and first publication

An npm owner must create or confirm the `stryketrade` organization and enable
two-factor authentication. The first public version establishes each package
under that scope and must be published from the exact reviewed tag:

```bash
git fetch origin --tags
git checkout npm-v0.1.0
npm ci
npm run build
npm run typecheck
npm test
npm publish -w @stryketrade/sdk --access public
npm publish -w @stryketrade/reference-bot --access public
```

The publish commands prompt for the account's current two-factor code. Run
them only after the tag's GitHub CI, including its Postgres integration job,
has passed.

Do not put an npm token in this repository, a committed `.npmrc`, or a GitHub
secret. After the first publication, configure both npm package settings with
the same GitHub Actions trusted publisher:

- organization or user: `dannydoritoeth`;
- repository: `stryke-sdk`;
- workflow filename: `publish-npm.yml`;
- environment: `npm-production`;
- allowed action: `npm publish`.

In each package's npm publishing-access settings, require two-factor
authentication and disallow token publishing after trusted publishing has
been verified.

## Subsequent releases

1. Update both package versions and the bot's exact `@stryketrade/sdk` dependency in
   one reviewed pull request.
2. Pass CI and merge the release candidate.
3. Create a protected annotated tag named `npm-v<version>` at that exact merge
   commit and push it.
4. Run the verification-only workflow from that tag:

   ```bash
   gh workflow run publish-npm.yml --ref npm-v<version> -f publish=false
   ```

5. Review the result, then run it again from the same tag and approve the
   protected `npm-production` environment:

   ```bash
   gh workflow run publish-npm.yml --ref npm-v<version> -f publish=true
   ```

6. Confirm the clean registry-install step passes and verify both npm package
   pages show provenance for the same source commit.

The workflow refuses a branch, a mismatched tag/version pair, different SDK
and bot versions, or an already-published version. It publishes the SDK first,
then the bot, and finally installs both packages into a clean temporary project
and runs the installed bot for two ticks.

The checksummed GitHub release tarballs remain the immutable Render handoff.
npm is the normal developer installation channel; neither publication path
authorizes wallet funding or live trading.
