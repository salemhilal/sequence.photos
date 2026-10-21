---
name: release-prep
description: Get Sequence ready to release a new version (web and Mac App Store) — check branches and CI, write patch notes, decide whether screenshots need retaking, run the checks, run the Release workflow on the user's go-ahead, and end with everything the App Store Connect forms need. Use when asked to prepare, prep, or get ready for a release, or for patch notes.
---

# Preparing a release

How releases work is in `docs/releasing.md`: the website deploys from `main` (Netlify); the
Mac app ships through the **Release** workflow, which bumps the version on `main`, tags it,
publishes the GitHub release, and uploads to App Store Connect. This skill gets everything
ready and hands the user the decisions. It never publishes by itself.

## 1. Where things stand

- Current version (`package.json`) and the last tag: `git tag --sort=-v:refname | head -1`;
  `gh release list --limit 3`.
- Unmerged work: open PRs (`gh pr list`), and branches ahead of `main`
  (`git branch -r --no-merged origin/main`). Ask which of them belong in the release.
- CI on what will ship: `gh run list --branch <branch> --limit 4` (CI and Mac app both green).
- The new version: ask the user whether this is a **major**, **minor**, or **patch** bump,
  saying the current version and what each would make it (e.g. "Now 1.2.3: major → 2.0.0,
  minor → 1.3.0, patch → 1.2.4"), with a recommendation from what changed (major for a new
  model or big UI change, minor for features, patch for fixes). Use the AskUserQuestion tool
  if it's there. The workflow refuses a version that isn't higher, or is already tagged.

## 2. Patch notes

From everything since the last tag: `git log --no-merges --format=%s <last-tag>..<branch>`,
plus merged PR titles and bodies (`gh pr list --state merged --base <branch>`).

- Keep what a user would notice; drop refactors, tests, docs, CI, and review fixes. Group
  related commits into one line.
- Write them in the app's voice (plain, short, sentence case; see AGENTS.md): a title line,
  then 4–8 bullets, the biggest change first, bold lead-ins. Under 4,000 characters (App
  Store "What's New"); no markdown on the App Store (plain bullets "•"), markdown for GitHub.
- Give the user both versions in the reply, and ask for changes. The GitHub version goes in
  the workflow's `notes` input.

## 3. Screenshots

Check whether the UI changed since they were taken:

```bash
since=$(git log -1 --format=%H -- docs/app-store)
git diff --stat "$since"..HEAD -- src/components src/styles.css site/app src/tour
```

If anything visible changed (layout, toolbar, pages, colors, new views), retake them with
the `screenshots` skill (`npm run screenshots`), look at each, and say which changed. If a
new feature deserves its own shot, propose adding it (App Store Connect takes up to 10).
Otherwise say they're still current.

## 4. Checks

Run all of them on the branch that will ship, and report failures in full:

```bash
npm run check
npm run build && node scripts/check-web-bundle.mjs
npm run app:ui:build && node scripts/check-app-bundle.mjs && npm run build
npm run server:check
npm run test:e2e
npm run test:app
```

Then go through `docs/testing.md`'s release items, and list the by-hand checks for the user
(the Mac app's menus, fullscreen, Instagram posting with a real account).

## 5. App Store readiness

- Signing and upload secrets exist: `gh secret list` (the six `APP_STORE_*`; the App Store
  workflow's header lists them). Certificates expire yearly; a failure there names them.
- Anything Apple reviews that changed since the last release: entitlements
  (`src-tauri/Entitlements.plist`), network use, data handling (the privacy policy,
  `site/privacy/`, and App Store Connect's privacy answers), sign-in flows. Flag each, with
  what the review notes should say (e.g. a test account for Instagram, if Meta's app isn't
  live for everyone).
- The server: if `server/` changed, it deploys separately (`npm run server:deploy:dev`, then
  `server:deploy`), by the owner, before the app that needs it.

## 6. Hand-off

Summarize: what ships, the patch notes, screenshots (current or retaken), checks, and
anything blocking. Then, each only on the user's explicit go-ahead ("ship it" covers all
three):

1. Merge the release branch into `main` (merge commit; this deploys the website).
2. Dry run: `gh workflow run release.yml -f version=X.Y.Z -f dry_run=true`; wait for it
   (`gh run watch <id> --exit-status`) and report it.
3. The real run: `gh workflow run release.yml -f version=X.Y.Z -f notes="…"` (the GitHub
   notes). Wait for it in the background (`gh run watch`); you're notified when it ends.

## 7. The App Store forms (after the upload)

When the real run finishes, check it did everything: both jobs green
(`gh run view <id> --json jobs`), the tag minted (`git ls-remote --tags origin vX.Y.Z`), the
GitHub release published (`gh release view vX.Y.Z`), and the App Store job's upload step
succeeded. If anything failed, report it in full instead, with the failing step's log.

Then open the screenshots folder in Finder (the `reveal_path` tool on `docs/app-store`), and
make the **last message** of the run everything the user needs for App Store Connect, ready
to paste, and nothing else after it:

- **Version:** X.Y.Z, and the build to pick (it appears under TestFlight, then in the
  version's Build section; processing can take a few minutes after upload).
- **What's New in This Version:** the App Store patch notes in a code block, plain text with
  "•" bullets (no markdown).
- **Screenshots:** the folder (revealed in Finder), the files in order, and whether they're
  new (upload, replacing the old ones) or unchanged (leave them).
- **App Review notes**, if anything reviewers need changed (e.g. how to try Instagram);
  otherwise say none are needed.
- **Anything else that changed and needs a form:** privacy answers, age rating, the
  description or keywords for a new headline feature. Say "nothing else" if so.
- Then: submit for review.

## Rules

- Never merge to `main`, run the Release workflow (dry runs included), deploy the server, or
  upload anything without the user's go-ahead for that step.
- Don't bump the version by hand; the workflow does it (`npm run bump` is for releasing
  without GitHub).
- Never paste secrets; check secrets by name only.
