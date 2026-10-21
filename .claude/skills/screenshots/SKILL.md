---
name: screenshots
description: Retake Sequence's screenshots (App Store, README, landing page) from the current UI with the six photos kept for them. Use when the UI has changed before a release, or when asked to update, retake, or add screenshots.
---

# Screenshots

`npm run screenshots` (`scripts/screenshots.mjs`) takes every screenshot from the Mac app's
interface as it is now: the Mac build's web side (`vite --mode app` on :5176, started if it
isn't running) in headless Chromium at 1440 × 900 pt @2x, with Tauri stubbed out and the
traffic lights drawn in. The project is "City Walks": the six photos in
`assets/screenshots/` (the owner's, large enough that nothing is enlarged or marked low
resolution), three on the desk and three placed in a four-page book at 300 dpi. Dark theme. It writes:

| File                                         | Use                                        |
| -------------------------------------------- | ------------------------------------------ |
| `docs/app-store/1-desk.png` … `5-export.png` | App Store Connect (2880 × 1800, Mac 16:10) |
| `docs/screenshot.jpg`                        | The README (the desk)                      |
| `site/landing/landing-*.jpg`                 | The landing page's four (2000 × 1250)      |

## Steps

1. Run it: `npm run screenshots`. `--only desk,preview` retakes some (matched against the
   names: desk, spread, preview, quick, export).
2. Look at every PNG (downscale with `sips -Z 1440` to a scratch folder first) before
   committing: nothing cut off, no warnings or empty states that weren't meant, the traffic
   lights clear of the toolbar's content, text legible.
3. If the UI changed shape (a class name, a page, a store), fix the script rather than
   editing images: it reaches into the app through its own modules (served under
   `/@fs/<repo>/src/`, so the script shares the app's module instances; plain `/src/...`
   would load second copies).
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
