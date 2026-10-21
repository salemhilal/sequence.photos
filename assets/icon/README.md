# App icon

Sequence's icon: three frames stacked, the wordmark's S on the top one. It comes in light
and dark, drawn in the app's own neutrals.

- `sequence-light.svg`, `sequence-dark.svg`: the drawings, on the macOS icon grid (an
  824 px tile with a shadow on a 1024 px canvas). Everything else is made from these.
- `sequence-light.png`, `sequence-dark.png`: 1024 px renders of the same, transparent
  around the tile.
- `sequence-light-square.png`, `sequence-dark-square.png`: 1024 px full-bleed squares,
  opaque, for places that want a plain square and round it themselves (Meta's app
  settings, for example).
- `AppIcon.icon`: the Mac icon as an Icon Composer file, light and dark.
- `favicon-light.svg`, `favicon-dark.svg`: the favicon, the icon simplified to read at
  16 px (two cards, no tile, heavier lines); `favicon-light.png`, `favicon-dark.png` are
  512 px renders, transparent around the cards.

After changing a drawing, run `npm run icons` and commit what it writes: these renders,
the Mac app's icons in `src-tauri/icons/` (`Assets.car` needs Xcode), and the website's
favicon and home-screen icons in `site/public/`. Where an icon can't follow light or dark, it's
the light one.
