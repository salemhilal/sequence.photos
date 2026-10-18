# Notes for agents

Sequence is a tool for sequencing photos into a book (spreads of facing pages) or a run of
frames (slides, an Instagram carousel), and exporting them as a PDF, images, an InDesign file,
or an Instagram post. It's a React + TypeScript web app at sequence.photos, also shipped as a
Tauri Mac app (WebKit) on the App Store. Instagram posting goes through a Cloudflare Worker in
`server/`, a separate package with its own README, tests, and deploy.

## Commands

```bash
npm run dev            # web app at http://localhost:5175/app/
npm test               # unit tests (vitest)
npm run test:e2e       # web interaction tests (Playwright: Chromium and WebKit; e2e/)
npm run build          # type-check and build
npm run lint           # oxlint
npm run format:check   # prettier
npm run test:app       # Mac app end to end (builds Tauri; a few minutes)
```

Run tests, build, lint, and format before calling work done; run `test:e2e` when the UI's
behavior changes (add or update a spec in `e2e/` for new interactions), and `test:app` too
when the Mac app, saving, or exports change. The first `test:e2e` needs
`npx playwright install chromium webkit`. The server is checked from `server/` (`npm test` there).

## Where things are

- `src/types.ts`: the project model. A project has a `page` (size, `unit` of `in` or `px`,
  and `pxPerUnit`: the dpi for inches, the density for pixels) and a `layout` of spreads or
  frames. Positions on pages are in the page's unit; the desk is always inches.
- `src/schema.ts`: saved-project migrations. Changing what's saved means bumping
  `CURRENT_SCHEMA`, adding a migration, and adding a sample to `schema.test.ts`.
- `src/pageSetup.ts`, `src/convertLayout.ts`: the Layout view's Page tab (a draft applied as
  one undo step) and the arrangement, unit, and size conversions.
- `src/renderPlan.ts`: what every export draws, in output pixels; `src/pdf.ts`,
  `src/rasterExport.ts`, `src/idml.ts`, `src/instagramImage.ts` draw from it.
- `src/platform/`: web vs Mac differences (`#platform` import).
- `docs/testing.md`: the manual and automated checklist. Update it with any behavior change.
- `docs/proposals/`: design proposals and plans (layout model, print and color).

## Conventions

- Strict TypeScript: no `any`, no non-null assertions outside tests.
- Match the surrounding code's style and comment density: a short doc comment on each export
  saying what it is and why, in plain words.
- UI copy is plain, short, and in sentence case. The Mac menu bar title-cases command names
  itself.
- Pure logic gets unit tests (vitest runs in Node: no canvas, no DOM unless a file opts into
  happy-dom); keep logic out of components where it can be (e.g. `statusText`, `wheeled`).
  Interactions get Playwright specs in `e2e/` (WebKit tests use a profile on disk: an
  ephemeral one won't store photos). The Mac app's own behavior (files, windows, fullscreen)
  is covered by `test:app`.
- Web and Mac skew is accepted: the user base is small, so a format change shouldn't block a
  merge (one line in the PR is enough).

## Data and secrets

- The dev server's data is disposable test data: change or reset it freely. Never touch the
  Mac app's real data or the user's own photos and files.
- Public materials (screenshots, the landing page, the tour) use only the six sample photos
  in `src/tour/`.
- Never paste secrets into code, logs, or chat. Server secrets are set by the owner with
  `wrangler secret put`.
