# The Mac app in Rust and GPUI

An experiment: the Mac app rewritten in Rust with [GPUI](https://gpui.rs), next to the
Tauri app, doing what it does as closely as possible. If it works out it ships on the App
Store as an update to the Tauri app (same identifier, same container, same documents).

Decisions so far:

- **Identifier.** `io.salem.PhotobookSequencer.gpui` while it's an experiment (its own
  TestFlight builds); `io.salem.PhotobookSequencer` when it replaces the Tauri app, as an
  update. It reads and writes the same `.photo-sequence` files and bookmarks.
- **Look.** The web app's current look (native-polish.md is in): its tokens in
  `src/styles.css` (gray steps, label column, Inter Tight and IBM Plex Mono) become a theme.
- **Scope.** Everything, in one release: desk, sidebar, spread editor, guides, crop, Quick
  Look, Preview, Layout, every export (PDF, images, InDesign, Instagram), Settings, the tour.
- **Logic.** `sequence-core` holds everything that doesn't draw a window and builds for
  `wasm32-unknown-unknown`, so the website could run it one day. No platform calls in it:
  decoding images, files, and the network come in through traits.
- **Platforms.** macOS 14 and later. Intel too (a universal binary) while it costs nothing.

## Layout

```
native/
├── Cargo.toml        # the workspace
├── core/             # sequence-core: model, migrations, geometry, render plan, exports' files
├── mac/              # sequence-mac: the GPUI app (bin "Sequence")
│   └── bundle/       # Info.plist and Entitlements.plist
└── scripts/bundle.sh # builds and signs Sequence.app
```

GPUI comes through `gpui-kit` (GPUI, `gpui-base`, and `gpui-component`), pinned to an exact
version: GPUI's API changes between releases, so updating it is its own change.

## Phases

### 0. App Store spike: done, but for the upload

A sandboxed window with the menu bar, the open and save panels, files opened from Finder,
and a security-scoped bookmark that reopens the last file after a restart. All of it works
in the App Sandbox with the Tauri app's entitlements. The binary links only public
frameworks and uses no private symbols (`otool -L`, `nm -u`).

`native/scripts/app-store.sh` builds the App Store package as `scripts/app-store.mjs` does
for the Tauri app (universal, the Tauri app's identifier and profile, signed for
distribution, a signed installer package) and, with an App Store Connect API key in the
environment, has Apple validate it (`altool --validate-app`) or uploads it (`UPLOAD=1`).
The package builds and its signature, entitlements, and profile check out locally; Apple's
validation hasn't run yet.

### 1. sequence-core: started

Done so far: the model (`types`), migrations (`schema`), `validate`, `units`, `crop` (but for
its drags), `geometry`, `renderPlan`, and the project file (`project.ts`'s format, with
`zip.ts`'s rules: stored, a manifest first). Each matches the TypeScript's golden files
(`shared/goldens/`: 39 saved projects, 307 geometry cases, 20 render plans), and project
files go both ways: Rust opens one the web app wrote, and the web app's reader opens one
Rust wrote. It builds for `wasm32-unknown-unknown`.

Still to port: `convertLayout`, `pageSetup`, `actions` and undo, `duplicate`, the clipboard
format, `resolution`, the crop drags, the desk's geometry, and Instagram's slide plans.

A port of the pure modules: `types`, `schema` (migrations), `validate`, `geometry`, `crop`,
`convertLayout`, `pageSetup`, `units`, `resolution`, `actions` and undo, `duplicate`, the
clipboard format, `renderPlan`, and the project file (ZIP).

Parity is checked with golden files: a Node script runs the TypeScript over
`shared/fixtures/` and generated cases and writes what it makes (render plans, conversions,
migrations) as JSON; the Rust tests must match. Rerunning it after a TypeScript change
shows where the two have drifted.

### 2. Images and exports, still without a window

- Decoding and thumbnails with ImageIO (HEIC, orientation, color profiles, as WebKit does).
- PDF with `pdf-writer` (original JPEGs pass through; color profiles can be tagged, toward
  print-and-color.md).
- Images with `image` and `fast_image_resize`; InDesign as `idml.ts` makes it; both zipped.
- Instagram through the server in `server/`; signing in with `ASWebAuthenticationSession`,
  as the iPhone app does.

### 3. The app's frame

The window, the toolbar's pages (Desk, Preview, Export), the status bar, the menus and every
shortcut (from `src/commands.ts`), undo and redo, documents (title with unsaved changes,
Save, Save As, Open, Open Recent, bookmarks), Settings, and holding ⌘ for shortcut badges.

### 4. Where the work happens

In about this order: the desk (pan, zoom, drag, Option-drag to duplicate, tidy, desk color,
drops); the sidebar (spreads or frames, reordered by dragging); the spread editor (rulers,
guides, snapping, mirroring, guides dragged out of rulers); crop; Quick Look; Layout (Page
and Guides, presets, a draft applied as one undo step); Preview and fullscreen; Export and
its previews; the tour, context menus, and hints.

### 5. Testing and releasing

`cargo test` for the core; GPUI's test context for views; an end-to-end run like
`test:app` that opens, edits, saves, and exports in the built app; a column in
`docs/testing.md`; and an App Store script from `scripts/app-store.mjs` (universal build,
signing, `productbuild`, upload).

## Risks

- GPUI moves fast; pinning helps, but updates will cost something.
- Accessibility (VoiceOver) comes from AccessKit in gpui-component and is thinner than WebKit's.
- Text fields, color pickers, and the like are GPUI widgets, not AppKit's.
- The size: about 19,000 lines of TypeScript and React. Phases 1–2 are well bounded;
  phase 4 is most of the work.
