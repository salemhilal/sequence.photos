---
name: screenshots
description: Retake Sequence's screenshots (App Store, README, landing page) from the current UI with the six photos kept for them. Use when the UI has changed before a release, or when asked to update, retake, or add screenshots.
---

# Screenshots

`npm run screenshots` (`scripts/screenshots.mjs`; its header says how) takes every screenshot
from the Mac app's interface as it is now, in the dark theme, on a Mac (it resizes with
`sips`). The project is "City Walks": the six photos in `assets/screenshots/`, three on the
desk and three in a four-page book; the last shot makes it a 4:5 Instagram carousel. It
writes `docs/app-store/` (App Store Connect), `docs/screenshot.jpg` (the README), and
`site/landing/landing-*.jpg` (the landing page's four).

## Steps

1. Run it: `npm run screenshots`. `--only desk,preview` retakes some (matched against the
   names: desk, spread, preview, quick, export, instagram).
2. Look at every PNG (downscale with `sips -Z 1440` to a scratch folder first) before
   committing: nothing cut off, no warnings or empty states that weren't meant, the traffic
   lights clear of the toolbar's content, text legible.
3. If the UI changed shape (a class name, a page, a store), fix the script rather than
   editing images. It reaches into the app through `SRC_URL` (`/@fs/…`); plain `/src/...`
   would load second copies of the modules.
4. If a shot was added, removed, or reordered: the landing page's `<img>`s and captions in
   `site/index.html` match the four `landing-*` files; App Store Connect takes up to 10.
5. Commit the images with the script change (if any).

## Rules

- Only the photos in `assets/screenshots/`. To change them, the user gives new ones: keep
  them large (about 3,600 px on the long side, JPEG quality 90, never enlarged), and update
  `PHOTOS` and the layout in the script. Never other photos, the user's other files, or the
  Mac app's real data.
- The script uses a throwaway browser profile; it doesn't touch the dev server's data on
  :5175 or anything else.
- App Store screenshots must show the app as it ships: don't stage features that aren't in
  the build.
