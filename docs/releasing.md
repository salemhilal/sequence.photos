# Releasing

## The website

Every push to `main` deploys to sequence.photos through Netlify, after
`npm test && npm run build` (`netlify.toml`); a failing test stops the deploy. Pull requests
and branches get preview deploys. Nothing else to do.

## The server

From the repo's root, by the owner (it needs `wrangler login`):

```bash
npm run server:deploy:dev   # the dev environment first
npm run server:deploy       # then production
```

Secrets are set with `wrangler secret put` (see [server/README.md](../server/README.md)), never
in files.

## The Mac app

Run the **Release** workflow (Actions → Release → Run workflow) with the new version (e.g.
`2.0.1`) and, optionally, release notes, or from the command line:

```bash
gh workflow run release.yml -f version=2.0.1
```

It sets the version everywhere (`npm run bump`), commits and tags it (`v` + the version) on
`main`, publishes the GitHub release, then runs the **App Store** workflow: it tests the app
end to end, builds a signed universal `.pkg`, and uploads it to App Store Connect. There, pick
the build (it shows in TestFlight) and submit it for review. Tick _Dry run_ to do the bump and
the tests without pushing, tagging, or uploading.

The App Store workflow also runs when a GitHub release is published by hand (its tag must be
`v` + `package.json`'s version), or on its own from Actions to upload `main` as it is. The
certificates, provisioning profile, and API key it needs are Actions secrets; its header lists
them.

Before a release, go through [testing.md](testing.md). If the UI changed, retake the screenshots
(`npm run screenshots`) and upload `docs/app-store/*.png` to the version in App Store Connect.

### By hand

`npm run bump 2.0.1` sets the version locally (`package.json`, `tauri.conf.json`,
`Cargo.toml`, and their lockfiles). `npm run app:store` builds the `.pkg` locally and uploads
it given an App Store Connect API key; [setup.md](setup.md#building-for-the-app-store-locally-optional)
lists what it needs. It says what's missing.
