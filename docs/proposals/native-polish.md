# Making Sequence feel like a real app

A visual-language pass, modeled on DaVinci Resolve and Capture One. Both are cross-platform
apps with their own UI, not AppKit's, yet neither reads as a web page. That comes from a set
of habits, listed below, that Sequence mostly doesn't follow yet.

## What Resolve and Capture One do

- **Tiled, not floating.** The window is divided edge to edge into panels (viewer, browser,
  inspector, timeline). Panels meet at hairlines or a 1–2 px gap of the window color. No
  rounded cards, no drop shadows on panels. Shadows appear only on things that float over
  the work: menus, popovers, tooltips, dialogs.
- **Elevation by gray steps.** Neutral grays (not warm, not near-black) in four or five
  levels: window, panel, panel header, control, and inset fields darker than the panel.
  Dividers between panels are _darker_ than the panels, not light lines.
- **Panel headers.** Every panel has a fixed-height header bar (about 26–28 px): a title on
  the left, icon actions and a ⋯ menu on the right. Capture One's tools are collapsible
  sections with the same header, plus a reset ↺ action and presets.
- **Small, even type.** Chrome text is 11–12 px in one sans, two weights. Numbers are
  tabular. Labels are muted sans, not capitals.
- **Compact controls with a grid.** Rows are 22–24 px. Each inspector row is a fixed label
  column and a control column, so values line up down the panel. Sliders have a thin track,
  a small knob, a value field at the right, and double-click to reset. Number fields scrub
  when you drag on them or their label.
- **Accent used rarely.** Resolve's orange is the playhead and a few active states; Capture
  One's highlight is selection. Selected segments and tabs are a lighter gray, not filled
  with the accent.
- **Pages, not modals.** Resolve's Media/Cut/Edit/Color/Deliver are pages switched from a
  bar; exporting (Deliver) is a page, not a dialog over the editor. Capture One keeps its
  output in tool tabs. Modals are for short questions.
- **A status line.** Counts, zoom, and progress live in a thin bar at the window's edge,
  not in floating buttons.
- **Desktop interaction.** The arrow cursor everywhere (the hand is for web links). No
  hover highlight on filled buttons; they respond on press. UI text can't be selected,
  images can't be dragged out as files by accident, menus open instantly.
- **Fine icons.** Thin, even strokes at 14–16 px, one color, lit only when active.

## Where Sequence differs today

| Area           | Now                                                                                                | Reads as                     |
| -------------- | -------------------------------------------------------------------------------------------------- | ---------------------------- |
| Cursor         | `cursor: pointer` on 18 rules, every `.btn`                                                        | A website                    |
| Selection      | Only some areas set `user-select: none`                                                            | Double-click selects UI text |
| Panels         | Sidebar, zoom buttons, inspector are rounded with `--shadow`                                       | Cards on a page              |
| Dark surfaces  | `#151514` and `#1c1c1a`: two near-black, warm steps                                                | Web dark mode                |
| Dividers       | `--border` is a light white-alpha line                                                             | Web                          |
| Accent         | Wordmark, Preview (outlined), segmented selections, Export button, tab underline, focus, selection | Brand-forward, busy          |
| Labels         | Mono capitals for section titles (INSTAGRAM, DESTINATION)                                          | Designed marketing page      |
| Controls       | 28 px buttons with hover fills; fields bordered; no label column                                   | Form on a page               |
| Zoom           | Three floating buttons, bottom left                                                                | A map widget                 |
| Sidebar cells  | Grip dots ⋮⋮ beside each number                                                                    | A sortable web list          |
| Layout, Export | Full-window modals over a dimmed app                                                               | Web dialogs                  |
| Icons          | Lucide at its default 2 px stroke                                                                  | Heavy, web-kit               |
| Wordmark       | An amber pill in the toolbar                                                                       | A site header                |

## Recommendations

In order: the first group is cheap and removes most of the "web" feel.

### 1. Desktop interaction (small, global)

- Arrow cursor everywhere; keep the hand only for real links (About, help links).
- `user-select: none` on the app's chrome; allow it in text fields, captions, and values
  people copy (version, file names). `-webkit-user-drag: none` on images and thumbnails.
- Filled buttons don't change on hover; they darken on `:active`. Ghost/icon buttons and
  menu items keep a quiet hover.
- Menus, popovers, and tooltips appear with no fade (or ≤ 80 ms).
- Thin themed scrollbars on the web (`scrollbar-width: thin; scrollbar-color: …`). WebKit on
  the Mac already uses overlay scrollbars.

### 2. Surfaces and elevation

New neutral tokens for dark (light gets the equivalent steps):

| Token               | Use                                | Dark      |
| ------------------- | ---------------------------------- | --------- |
| `--surface-window`  | Toolbar, gaps between panels       | `#1b1b1b` |
| `--surface-panel`   | Sidebar, inspectors                | `#242424` |
| `--surface-header`  | Panel header bars, raised controls | `#2c2c2c` |
| `--surface-control` | Buttons, segmented tracks          | `#333333` |
| `--surface-inset`   | Fields, wells, slider tracks       | `#181818` |
| `--divider`         | Lines between panels               | `#0e0e0e` |

- The sidebar, inspector, and Export's settings become flush panels: no radius, no shadow,
  divided from the desk by `--divider`.
- `--shadow` is kept for menus, popovers, tooltips, the toast, and dialogs only.
- A faint top highlight on raised controls (`inset 0 1px 0 rgba(255,255,255,0.05)`), as
  Resolve's buttons have.
- Radius scale: 3 px controls, 5 px menus and popovers, 8 px dialogs, 0 for tiled panels.

### 3. Panel headers and inspector grid

- One `PanelHeader` component: 28 px, title (12 px sans, medium), actions on the right.
  Used by the sidebar ("Spreads" + add + columns), the Layout inspector, Export's settings.
- Inspector rows on a grid: an 84 px label column (muted, right- or left-aligned) and a
  control column. Layout's Page tab and Export would line up like Capture One's tools.
- Sections become collapsible, with a reset ↺ where a section has defaults (guides, export
  quality).

### 4. Controls

- Rows at 24 px; buttons 24 px in panels, 26 px in the toolbar.
- Fields: `--surface-inset`, no border (a 1 px inner hairline at most), 3 px radius, unit
  inside at the right in muted mono.
- Number fields scrub: drag horizontally on the label or field to change the value;
  Shift for coarse, Option for fine. Double-click a slider to reset.
- Sliders: 2 px track, 10 px knob, value field at the right.
- Segmented controls and tabs: the selected item is `--surface-header` with full-strength
  text; unselected is muted. No amber fill.

### 5. Accent discipline

Amber is for: selection on the desk and in the sidebar, the one primary button in a view
(Export), and active toggles (an icon tint). Not for: the wordmark, segmented selections,
tabs, or an outlined Preview button. Preview becomes an ordinary toolbar button.

### 6. Type

- Chrome text at 12 px (13 px only for dialog body text). Tabular numbers throughout.
- Section and field labels in sans (11–12 px, muted), not mono capitals. Mono stays for
  data: dimensions, dpi, counts, folios, shortcuts, file names, where it earns its place.
- The toolbar wordmark goes on the Mac (the title bar names the project) and becomes
  plain text, or a small monochrome mark, on the web.

### 7. A status bar, and zoom in it

A 22 px bar along the bottom of the desk: photo counts (on desk / placed), import progress
(the toast's job, in place), save state, and at the right the zoom: −, a percentage
menu (Fit, 50 %, 100 %, 200 %), +. The floating zoom buttons go.

### 8. Sidebar cells

Drop the grip dots; drag the whole cell. Each cell gets a dark well behind the thumbnail,
the number below (or overlaid) in small mono, and selection as a lighter cell with a thin
amber outline, like Capture One's browser.

### 9. Pages instead of modals (larger)

Desk, Layout, and Export become pages of one window, switched from a segmented control in
the toolbar (as Resolve's page bar), each with the same toolbar and status bar. Layout and
Export already have a stage and an inspector, so they fit this shape. Settings stays a
dialog on the web and becomes its own window in the Mac app (a second Tauri window), as
Mac apps do.

### 10. Icons

Lucide at `strokeWidth={1.5}` and 15–16 px, set once (a wrapper or CSS
`.lucide { stroke-width: 1.5 }`). Muted by default, full text color on hover, amber only
when active.

## Order of work

1. Interaction defaults (1) and icons (10): a day, global CSS, no layout change.
2. Surfaces, radius, and accent (2, 5): token changes plus removing card styling.
3. Panel header and inspector grid (3), controls (4), type (6): component work, view by
   view (sidebar, Layout, Export, Settings, menus).
4. Status bar and zoom (7), sidebar cells (8).
5. Pages (9), and the Mac Settings window: a structural change, worth its own plan.

Each step is shippable alone and should be checked in both themes, at the web's
smallest supported width, and in the Mac app.

## Sources

Research into both apps' current interfaces turned up little that is specific (manuals
and vendor pages, more than design write-ups), so the description above also draws on
working knowledge of Resolve 18–19 and Capture One 16 and 23.

- [Capture One: user interface](https://support.captureone.com/hc/en-us/sections/360000662757-User-Interface)
- [Capture One: interface terminology (CreativeLive)](https://site.creativelive.com/class/quick-start-to-capture-one-david-grover/lessons/capture-one-interface-terminology)
- [DaVinci Resolve 19 release notes (Newsshooter)](https://www.newsshooter.com/2024/08/21/davinci-resolve-19-final-release/)
- [How to make absolutely any app look like a macOS app (Evil Martians)](https://evilmartians.com/chronicles/how-to-make-absolutely-any-app-look-like-a-macos-app)
- [“A common tell in web apps” (Raycast, via Unsung)](https://unsung.aresluna.org/this-is-a-common-tell-in-web-apps-and-we-did-a-lot-of-work-to-eliminate-it/)
