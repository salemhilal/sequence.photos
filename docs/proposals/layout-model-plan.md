# Plan: spreads or frames, inches or pixels

Status: implementation plan for [layout-model.md](layout-model.md), steps 1–4. Step 5 (tiled
web export, native rendering on the Mac) is out of scope. Nothing here is implemented yet.

Each step below is one PR, made of one or a few commits. After every commit the app works and
`npm test`, `npm run build`, `npm run lint`, and `npm run format:check` pass.

## For the implementer

- Match the surrounding code: its style, naming, and comment density (a short doc comment on
  each export, saying what it is and why, in plain words).
- Strict TypeScript, no `any`, no non-null assertions outside tests (`!` is used in tests).
- UI copy is plain and short, in sentence case, like what's there now.
- Don't touch `server/`. `instagramPost.ts` imports types from it. That's fine, but don't
  change them.
- The desk stays in inches. Only pages, guides, and placements use the document's unit.
- Pure functions get unit tests (vitest runs in `node`, so there's no canvas, no
  `createImageBitmap`, no DOM). Anything that needs a canvas is kept thin and checked by hand,
  or in the Mac e2e run (`npm run test:app`), which runs in WebKit.
- Update `docs/testing.md` in the same PR as the behavior it describes.

## Branch sites today, and what each becomes

Every place that branches on `print`/`digital` today, found by grepping for `'print'`,
`'digital'`, `layout.kind`, `sheet.layout`, `TERMS[`, `UNITS[`, `settings.sizes`, `'whole'`,
`LayoutKind`, `layout.page`, and `layout.frame`. **A** = arrangement, **U** = unit, **E** = export
capability, **—** = goes away.

| Where                                                                    | Today                                                                       | Becomes                                                                                         | Step |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---- |
| `types.ts` `PrintLayout`/`DigitalLayout`, `LayoutKind`                   | kind + size per layout                                                      | `SpreadsLayout`/`FramesLayout` (**A**), size in `Project.page: PageSetup`                       | 1    |
| `types.ts` `Settings.sizes`                                              | each kind's last size                                                       | **—** (dropped in migration)                                                                    | 1    |
| `types.ts` `Sheet.layout`                                                | `LayoutKind`                                                                | `arrangement` (**A**), `unit` (**U**), `pxPerUnit`                                              | 1    |
| `units.ts` `UNITS: Record<LayoutKind, Units>`                            | keyed by kind                                                               | `Record<Unit, Units>` (**U**); gains `name` (from `TERMS.unitName`)                             | 1    |
| `units.ts` `TERMS: Record<LayoutKind, Terms>`                            | keyed by kind                                                               | `Record<Arrangement, Terms>` (**A**); loses `unitName`; `save` goes in step 3                   | 1, 3 |
| `units.ts` `DEFAULT_PAGE`, `DEFAULT_FRAME`, `FRAME_PRESETS`              | sizes                                                                       | `DEFAULT_PAGE: PageSetup`, `DEFAULT_FRAME: PageSetup`; `PRESETS` (arrangement + page) in step 2 | 1, 2 |
| `spreads.ts` `allSpreads`, `sheetOf`                                     | `l.kind === 'print'`, `l.page`/`l.frame`                                    | `l.kind === 'spreads'` (**A**); size, unit, dpi from `p.page`                                   | 1    |
| `geometry.ts` `sideAt`, `sheetExtent`, `relayoutRect`                    | `s.layout`                                                                  | `s.arrangement` (**A**)                                                                         | 1    |
| `geometry.ts` `clampBorder`                                              | `UNITS[s.layout].minBox`                                                    | `UNITS[s.unit].minBox` (**U**)                                                                  | 1    |
| `actions.ts` `addSpread`, `putOnNewSpread`, `deleteSpread`, `moveSpread` | `l.kind === 'print'`                                                        | `l.kind === 'spreads'` (**A**)                                                                  | 1    |
| `actions.ts` `folioLabel`, `spreadLabel`                                 | `layout: LayoutKind`                                                        | `arrangement: Arrangement` (**A**)                                                              | 1    |
| `actions.ts` `duplicatePhotos` offset                                    | digital: `offset * pageW / 10`; print: `offset`                             | `offset * pageW / 10` for both (**—**)                                                          | 2    |
| `convertLayout.ts`                                                       | re-paginate + the `k` scale + other kind's size                             | `rearrange` (**A**, no scale) and `convertUnits` (**U**, ×/÷ dpi)                               | 1, 2 |
| `pageSize.ts` `switchLayout`, `setLayoutSize`, `setPageSize`             | kind switch + `settings.sizes`                                              | `pageSetup.ts`: `withPageSetup`, `applyPageSetup` (one Apply for everything)                    | 2    |
| `schema.ts`, `validate.ts`, `store.ts` `emptyProject`                    | v3 shape                                                                    | v4 shape                                                                                        | 1    |
| `pdf.ts` `PT: Record<LayoutKind, number>`                                | 72 / 1                                                                      | `PT: Record<Unit, number>` (**U**); title/stem from `TERMS[arrangement]` (**A**)                | 1    |
| `pdf.ts` embeds `img.thumb`                                              | 1,400 px previews                                                           | real resolution via the render plan                                                             | 3    |
| `idml.ts` `PT = 72`, `ViewPreference … Inches`                           | inches only                                                                 | points per unit (**U**), rulers in the document's unit                                          | 3    |
| `frames.ts` `exportFrames`, `renderFrame(s)`                             | `layout.kind !== 'digital'`                                                 | `rasterExport.ts`: render any output page from a plan (**E**: both arrangements)                | 1, 3 |
| `instagramImage.ts` `renderPostImage(frame, size, …)`                    | frames in px                                                                | renders a slide (a page of any spread) from a plan (**E**)                                      | 3    |
| `instagramPost.ts` `PostOptions.frames: Frame[]`, `size`                 | frames                                                                      | `slides: Slide[]`, `sheet` (**E**)                                                              | 3    |
| `commands.ts` `exportIndesign`, `exportFrames`, `postToInstagram`        | print / digital / digital                                                   | spreads / both (`exportImages`) / both (**E**)                                                  | 1, 3 |
| `platform/macos/menu.ts` `sync`                                          | `indesign` enabled for print, `images` for digital, `TERMS[layout].Spreads` | `indesign` for spreads, `images` always (**E**); `TERMS[arrangement]` (**A**)                   | 1, 3 |
| `App.tsx` `digital`, `instagramBlocked`, File menu                       | digital-only Instagram and images                                           | Instagram needs only a connection; File menu shows images always, InDesign for spreads (**E**)  | 1, 3 |
| `components/Preview.tsx` save button                                     | PDF or images by kind                                                       | "Export…" menu with the File menu's export items (**E**)                                        | 3    |
| `components/SpreadEditor.tsx` inspector ppi / "Enlarged"                 | by kind                                                                     | by unit in step 1 (**U**); one coverage metric in step 4                                        | 1, 4 |
| `components/SpreadEditor.tsx` `guideSummary(…, layout)`, `PileStrip`     | `LayoutKind`, `TERMS[project.layout.kind]`                                  | `Arrangement` (**A**)                                                                           | 1    |
| `components/Sidebar.tsx` `GRID_MIN_CELL`, `MIN_THUMB`, `print`           | keyed by kind                                                               | keyed by arrangement (**A**)                                                                    | 1    |
| `components/LayoutEditor.tsx` `SAMPLES`, `mirrored`                      | keyed by kind                                                               | keyed by arrangement (**A**); `Ruler` gets `unit` (**U**)                                       | 1    |
| `components/LayoutPanel.tsx` `EDGES`, guides note, unit name             | keyed by kind                                                               | `EDGES` by arrangement (**A**); "Distances in {UNITS[unit].name}" (**U**)                       | 1    |
| `components/Ruler.tsx` `RULER_STEPS`, `layout` prop                      | keyed by kind                                                               | keyed by unit (**U**)                                                                           | 1    |
| `components/PageSizeFields.tsx`                                          | print/digital toggle, `remembered` sizes                                    | `PageSettings.tsx` (step 2)                                                                     | 1, 2 |
| `components/Desk.tsx` empty desk copy                                    | `TERMS[project.layout.kind].pages`                                          | `TERMS[arrangement]` (**A**); setup card uses `PageSettings`                                    | 1, 2 |
| `components/InstagramPost.tsx`                                           | frames only, "Skip empty frames", first 10                                  | slides from any document, slide picker                                                          | 3    |
| `tour.ts` Layout step copy                                               | "a print book or a digital sequence"                                        | spreads or frames, inches or pixels                                                             | 2    |
| `platform/macos/e2e.ts`                                                  | `switchLayout('digital')`, `layout.frame`, `renderFrames`                   | updated per step (see each step)                                                                | 1–3  |
| `drag.ts` `'whole'`                                                      | a frame's page side                                                         | unchanged: `'whole'` stays the `PageSide` of a frame                                            | —    |

## Step 1: Model

The arrangement and unit still move together: spreads are always inches at 300 dpi, frames
always pixels at 1×. No visible change except one (see Questions, item 1).

### Types (`src/types.ts`)

```ts
/** Facing pages (a book) or single pages in order (a sequence). */
export type Arrangement = 'spreads' | 'frames';
/** What sizes and positions on pages are stored in. The desk is always inches. */
export type Unit = 'in' | 'px';

/** The page: one page's size (a spread is two), its unit, and its resolution. */
export interface PageSetup {
  /** One page's size, in `unit`. */
  w: number;
  h: number;
  unit: Unit;
  /**
   * Output pixels per unit: the dpi for inches (300 by default), the pixel density for
   * pixels (1). Exports make this many pixels, and warnings check against it.
   */
  pxPerUnit: number;
}

/** A book: a single first page, spreads, a single last page. Was PrintLayout. */
export interface SpreadsLayout {
  kind: 'spreads';
  firstSpread: FirstSpread;
  spreads: MiddleSpread[];
  lastSpread: LastSpread;
}

/** A sequence: frames, all one size, in order. Was DigitalLayout. */
export interface FramesLayout {
  kind: 'frames';
  /** Never empty. */
  frames: [Frame, ...Frame[]];
}

export type Layout = SpreadsLayout | FramesLayout;

export interface Settings {
  centerV: boolean;
  centerH: boolean;
  keepRelative: boolean;
  borders: BorderGuide[];
  lines: LineGuide[];
  dropBorder: GuideId | null;
  // `sizes` is gone.
}

/** What geometry lays photos out on (see `sheetOf`). Never saved. */
export interface Sheet extends Settings {
  arrangement: Arrangement;
  unit: Unit;
  pxPerUnit: number;
  pageW: number;
  pageH: number;
}

export const CURRENT_SCHEMA = 4;

export interface Project {
  schemaVersion: typeof CURRENT_SCHEMA;
  photos: Record<PhotoId, PhotoMeta>;
  pile: Placement[];
  /** The page size, unit, and resolution, shared by every spread or frame. */
  page: PageSetup;
  layout: Layout;
  settings: Settings;
  nextZ: number;
}
```

`Size` stays (used by Instagram and presets). `LayoutKind` is deleted, not aliased, so the
compiler finds every site. Update the file's header comments ("inches in print, pixels in
digital" → "in the page's unit").

### Units and terms (`src/units.ts`)

- `UNITS: Record<Unit, Units>`, keys `in` and `px`, same values as today's `print`/`digital`.
  `Units.suffix` becomes `Unit`. Add `name: 'inches' | 'pixels'` (moved from `Terms.unitName`).
- `TERMS: Record<Arrangement, Terms>`, keys `spreads` and `frames`, same values minus `unitName`.
- `DEFAULT_PAGE: PageSetup = { w: 10, h: 8, unit: 'in', pxPerUnit: 300 }` and
  `DEFAULT_FRAME: PageSetup = { w: 1080, h: 1350, unit: 'px', pxPerUnit: 1 }`.
- Add `export const DEFAULT_DPI = 300;` (used by the migration, `convertLayout`, and later the
  "Print at" field).
- `FRAME_PRESETS` stays for now (step 2 replaces it).

### Reading the project (`src/spreads.ts`)

- `allSpreads`: `l.kind === 'spreads'`.
- `sheetOf(p)`: `{ arrangement: l.kind, unit: p.page.unit, pxPerUnit: p.page.pxPerUnit, pageW: p.page.w, pageH: p.page.h, ...settings }`.
- `hasFrames` unchanged.

### Schema v4 (`src/schema.ts`)

```ts
/**
 * 3 → 4: the layout's kind no longer decides its unit. A print book becomes spreads in
 * inches at 300 dpi, a digital sequence frames in pixels at 1×, and the page size moves out
 * of the layout to the project. Each kind's remembered size goes: arrangements share one.
 */
3: (project) => {
  const { layout, settings, ...rest } = project;
  const { sizes: _sizes, ...kept } = settings as Raw;
  const l = layout as Raw;
  if (l.kind === 'print') {
    const { kind: _k, page, ...spreads } = l;
    return { ...rest, page: { ...(page as Raw), unit: 'in', pxPerUnit: DEFAULT_DPI }, layout: { kind: 'spreads', ...spreads }, settings: kept };
  }
  if (l.kind === 'digital') {
    const { kind: _k, frame, ...frames } = l;
    return { ...rest, page: { ...(frame as Raw), unit: 'px', pxPerUnit: 1 }, layout: { kind: 'frames', ...frames }, settings: kept };
  }
  // Anything else is damage, which validateProject reports.
  return project;
},
```

The `2:` step writes `settings.sizes` with `DEFAULT_FRAME` (a `Size` then). It must keep
writing a plain `{ w: 1080, h: 1350 }` so the v2 → v3 → v4 chain is unchanged: inline the
literal there rather than importing the new `DEFAULT_FRAME` (now a `PageSetup`). The `0:` step
deletes `v1.sizes` from `emptyProject().settings`, which no longer has it; that line goes.

Check that the oxlint config accepts `_`-prefixed unused destructured names; otherwise use
`delete` on a copy, as the `0:` step does.

### Validation (`src/validate.ts`)

- `layout(v, item)`: kinds `'spreads'` and `'frames'`; no `page`/`frame` field.
- New `page(v, where): PageSetup`: `w`, `h` > 0; `unit` is `'in'` or `'px'`; `pxPerUnit` > 0 and
  finite. Any positive density is accepted for pixels, so a later 2× needs no schema change.
- `settings()`: drop `sizes`.
- `validateProject`: reads `d.page`; the `spreads` list for `nextZ` uses `book.kind === 'spreads'`.

### Store (`src/store.ts`)

`emptyProject()`: `page: { ...DEFAULT_PAGE }`, `layout: { kind: 'spreads', … }`, no
`settings.sizes`.

### Everything else in step 1

Mechanical renames per the table above: `'print'` → `'spreads'`, `'digital'` → `'frames'`,
`s.layout` → `s.arrangement` (or `s.unit` where it's about units), `UNITS[x]` keyed by unit,
`TERMS[x]` keyed by arrangement, `layout.page`/`layout.frame` → `project.page`.

- `convertLayout(project, arrangement)`: keeps today's behavior (re-paginate, scale by `k`, take
  the other kind's size) so nothing visible changes. With `settings.sizes` gone, the target is
  `DEFAULT_FRAME` or `DEFAULT_PAGE`, and the result's `page` is that whole `PageSetup`. It's
  rewritten in step 2.
- `pageSize.ts`: `switchLayout(arrangement: Arrangement, size?: Size)`; `setLayoutSize` sets
  `d.page.w`/`d.page.h`. `lastSwitch` still restores exactly.
- `PageSizeFields.tsx`: the toggle's options become `{ value: 'spreads', label: 'For print' }`,
  `{ value: 'frames', label: 'For digital' }`. `remembered` goes. Picking the other one fills
  the default size for it (`DEFAULT_FRAME` or `DEFAULT_PAGE`), unless switching straight back.
- `Ruler.tsx`: `RULER_STEPS: Record<Unit, RulerSteps>`, prop `unit: Unit`.
- `SpreadEditor.tsx` inspector: `sheet.unit === 'in'` → ppi, `'px'` → "Enlarged" (same text as
  today).
- `pdf.ts`: `PT: Record<Unit, number> = { in: 72, px: 1 }`.
- `frames.ts`: `layout.kind !== 'frames'`; size from `project.page`.
- `e2e.ts`: `switchLayout('frames')`; `layout.frame.w` → `projectStore.project.page.w`;
  `layout.kind === 'frames'`; `setWidth` is unchanged (it calls `setLayoutSize`).

### Tests (step 1)

- `schema.test.ts`: add a v3 sample (a print book with `settings.sizes`, copied from a real
  save) and change `expected` to v4 (`page: { w: 10, h: 8, unit: 'in', pxPerUnit: 300 }`,
  `layout.kind: 'spreads'`, no `sizes`). Add a separate test: a v3 digital sequence becomes
  `kind: 'frames'` with `page: { w: 1080, h: 1350, unit: 'px', pxPerUnit: 1 }` and the same
  frames. Add a test that a v3 layout of unknown kind throws `InvalidProjectError`.
- `validate.test.ts`: replace the `sizes` test; add `page` tests (missing, zero size, unknown
  unit, zero or negative `pxPerUnit`); "a frames layout needs at least one frame".
- `units.test.ts`, `geometry.test.ts` (the `Sheet` fixture), `actions.test.ts` (labels),
  `convertLayout.test.ts`, `duplicate.test.ts`: rename keys. `convertLayout.test.ts`'s "The
  book's size is remembered" assertion goes.
- Run `npm test`, `npm run build`, `npm run lint`, `npm run format:check`, and
  `npm run test:app` (e2e changed).

### Docs (step 1)

`docs/testing.md`: "Each format remembers its own last size" goes. Otherwise unchanged.

## Step 2: Separate the axes

### Commits

1. **Model**: unit conversion, re-pagination without the scale, one Apply for every page
   change, presets. The old `PageSizeFields` keeps working on top of it for this commit.
2. **Page settings**: the shared `PageSettings` component, the Layout view's Page and Guides
   tabs with the live preview, the setup card, tour copy, `docs/testing.md`.

### Conversions (`src/convertLayout.ts`)

Split today's `convertLayout` into two pure functions.

```ts
/**
 * Re-paginate: each page becomes a frame (spreads → frames), or frames pair into spreads.
 * Same page size, same unit. Each photo goes to the page holding its center.
 */
export function rearrange(project: Project, arrangement: Arrangement): Project;

/**
 * Store the project in another unit: every page size, placement, and guide multiplied by
 * the dpi (in → px) or divided by it (px → in). Same physical size. Not rounded, so a round
 * trip comes back. The new page's pxPerUnit is `dpi` for inches, 1 for pixels.
 */
export function convertUnits(project: Project, unit: Unit, dpi: number): Project;
```

- `rearrange` is today's `convertLayout` with `k = 1`, no `size`, no `relayoutRect` (that moves
  to `withPageSetup`), and no `settings.sizes`. `fit()` becomes a shift only.
- `convertUnits` scales `page.w/h`, every item's `x/y/w/h`, every border guide's distances, and
  every line guide's `at` by `f = unit === 'px' ? dpi : 1 / dpi`. The desk (`pile`) is not
  touched.

### One Apply (`src/pageSetup.ts`, replacing `pageSize.ts`)

```ts
/** What the Page tab edits, applied together. */
export interface PageDraft {
  arrangement: Arrangement;
  /** The size in `page.unit`; `page.pxPerUnit` is the dpi (inches) or 1 (pixels). */
  page: PageSetup;
  /** What photos do when the size changes: move with the guides, or keep their place. */
  content: 'rescale' | 'fixed';
}

export function draftOf(p: Project): PageDraft;
export function sameDraft(a: PageDraft, b: PageDraft): boolean;

/**
 * The project as it'd be with `draft` applied: converted to the draft's unit (at the
 * project's dpi, or the draft's when going to inches), re-paginated, then resized, photos
 * moving with the guides (`rescale`) or keeping their place (`fixed`), border guides kept on
 * the page. Pure, apart from new spread ids for pages that become frames.
 */
export function withPageSetup(project: Project, draft: PageDraft): Project;

/** The project the next Apply starts from: the start of the current run of Applies. */
export function pageSetupBase(): Project;

/** Apply a draft as one undo step. */
export function applyPageSetup(draft: PageDraft): void;

/** The size the draft's fields show after switching unit: the page converted at `dpi`. */
export function convertedSize(page: PageSetup, unit: Unit, dpi: number): Size;
```

`withPageSetup(project, draft)`, in order:

1. If the unit differs: `convertUnits(project, draft.page.unit, dpi)`, where `dpi` is the
   project's `pxPerUnit` going in → px and `draft.page.pxPerUnit` (the "Print at" value) going
   px → in. See Questions, item 3.
2. If the arrangement differs: `rearrange`.
3. If the size differs from the converted size: today's `setPageSize` body as a pure function
   (`resizeProject(project, size, relative)`), using `draft.content === 'rescale'` in place of
   `settings.keepRelative`.
4. Set `page.pxPerUnit = draft.page.pxPerUnit` (1 for pixels) and
   `settings.keepRelative = draft.content === 'rescale'`.

Same order as today's `convertLayout` (re-paginate, then relayout on the new arrangement's
sheet).

`applyPageSetup` merges today's `resizeRun` and `lastSwitch` into one run:

```ts
let run: { base: Project; out: Project } | null = null;

export function applyPageSetup(draft: PageDraft): void {
  const now = projectStore.project;
  if (sameDraft(draftOf(now), draft)) return;
  if (run?.out !== now) run = { base: now, out: now };
  // Back to where the run started: the project as it was, exactly.
  const next = sameDraft(draftOf(run.base), draft) ? run.base : withPageSetup(run.base, draft);
  projectStore.replace(next);
  run.out = projectStore.project;
}
```

This keeps both of today's guarantees: 10 → 8 → 10 puts everything back, and switching
straight back to spreads restores the book exactly. Every Apply is computed from the run's
start, so conversions don't compound. `pageSetupBase()` returns `run.base` when
`run.out === projectStore.project`, else the present. The live preview needs it so that it
shows exactly what Apply will make.

`switchLayout`, `setLayoutSize`, and `setPageSize` go. e2e's `setWidth` calls
`projectStore.apply((d) => { d.page.w = w; })`.

### Presets (`src/units.ts`)

```ts
export interface Preset {
  label: string;
  arrangement: Arrangement;
  /** The resolution is kept from the draft when it's inches, else 300 dpi / 1×. */
  page: Omit<PageSetup, 'pxPerUnit'>;
}

export const PRESETS: Preset[] = [
  { label: 'Book', arrangement: 'spreads', page: { w: 10, h: 8, unit: 'in' } },
  { label: 'Zine', arrangement: 'spreads', page: { w: 5.5, h: 8.5, unit: 'in' } },
  { label: 'Square book', arrangement: 'spreads', page: { w: 8, h: 8, unit: 'in' } },
  { label: 'Slides', arrangement: 'frames', page: { w: 13.33, h: 7.5, unit: 'in' } },
  { label: 'Instagram 4:5', arrangement: 'frames', page: { w: 1080, h: 1350, unit: 'px' } },
  // The Instagram app takes 3:4; its upload API doesn't (posting crops or expands it).
  { label: 'Instagram 3:4 (app uploads)', arrangement: 'frames', page: { w: 1080, h: 1440, unit: 'px' } },
  { label: 'Instagram square', arrangement: 'frames', page: { w: 1080, h: 1080, unit: 'px' } },
  { label: 'Instagram landscape', arrangement: 'frames', page: { w: 1080, h: 566, unit: 'px' } },
  { label: 'Instagram story', arrangement: 'frames', page: { w: 1080, h: 1920, unit: 'px' } },
];

/** The preset a draft matches, if any (the menu shows "Custom" otherwise). */
export function presetOf(d: PageDraft): Preset | undefined;
```

`FRAME_PRESETS` goes. No preset is pixel spreads, but every combination is reachable by hand.

### Unit-specific constants

- `duplicatePhotos`: `const onSpread = (offset * sheet.pageW) / 10` for both units (0.25 in on a
  10 in page, 27 px on a 1,080 px frame). Update the doc comment. On a 5.5 in zine it becomes
  0.1375 in.
- `UNITS.px` constants (`nudge` 1, `snap` 10, `minBox` 24, `guideStep` 25, `minSize` 100,
  `minPhoto` 10) and the pixel ruler's steps (up to 1000) stay as they are. A converted
  3000 × 2400 px page works, but see Questions, item 7. Add 2500 and 5000 to
  `RULER_STEPS.px.numbers`, so a 6000 px spread's ruler doesn't crowd.

### Page settings component (`src/components/PageSettings.tsx`, replacing `PageSizeFields.tsx`)

```ts
interface PageSettingsProps {
  /** The draft, owned by the caller (the Layout view keeps it across tabs). */
  draft: PageDraft;
  onChange: (draft: PageDraft) => void;
  /** Hide "Content" when nothing is placed (the new-project card). */
  showContent: boolean;
}
```

Plus a small wrapper, `usePageDraft()`, holding `[draft, setDraft]`. It resets to `draftOf(project)`
when the project changes some other way (undo, a guide edit). It does this the way today's form
is keyed on the current size: compare against the last `draftOf` seen.

Layout of the form (matching the proposal):

```
Pages        [ Spreads | Frames ]
Size         [ 10 ] × [ 8 ]  [ in ▾ ]     Presets [ Book ▾ ]
Resolution   [ 300 ] dpi                   (pixels: "1×", not editable)
Content      (•) Rescale with layout  ( ) Keep fixed
             [ Revert ]  [ Apply ]
```

- **Pages**: `Segmented halves` with Spreads and Frames.
- **Size**: two `NumberField`s with `UNITS[draft.page.unit]`, and a unit `<select>` (in, px).
  Changing the unit fills the size with `convertedSize(current page, unit, dpi)`. That's
  3000 × 2400 from 10 × 8 in at 300. Going px → in, the **Resolution** row reads "Print at
  [300] dpi" and changing it recomputes the size, until the user edits the size by hand
  (track `sizeEdited` in local state).
- **Presets**: a `<select>` of `PRESETS` plus "Custom". Picking one sets the arrangement, unit,
  and size together.
- **Resolution**: inches: `NumberField` labelled "dpi", min 1, whole numbers, default 300.
  Pixels: a read-only "1×", with help "Pixel density" in a `title`.
- **Content**: two radios. Enabled only when the draft's size differs from the converted
  current size, because otherwise nothing moves. Help: "Photos move and scale with the
  guides." / "Photos keep their size and place, so their resolution doesn't change."
- **Apply**: primary when `!sameDraft(draft, draftOf(project))`. Calls
  `applyPageSetup(draft)`. Enter submits.
- **Revert**: sets the draft back to `draftOf(project)`.
- A one-line note under the fields says what Apply will do, when it re-paginates: "Each page
  becomes a frame." / "Frames pair up into spreads."

### Layout view (`LayoutEditor.tsx`, `LayoutPanel.tsx`)

- The panel gets tabs at the top: `[ Page | Guides ]`, as a `Segmented` (or `role="tablist"`).
  Remember the tab in `ui` (not saved) so the tour can open Guides.
- **Page tab**: `PageSettings` (from the lifted draft). The old "Spreads" section and the
  "Keep photos relative to guides" checkbox go; it's now Content in the draft.
- **Guides tab**: the Center lines, Border guides, and Guides sections, unchanged. Every edit
  still applies right away and is its own undo step.
- `LayoutEditor` owns the draft (`usePageDraft`) so it survives tab switches.
- **The stage**:
  - Guides tab, or no pending draft: today's empty sample page with rulers and draggable
    guides.
  - Page tab with a pending draft: a new `PagePreview` component.

`PagePreview` (`src/components/PagePreview.tsx`):

```ts
interface PagePreviewProps {
  draft: PageDraft;
}
```

- `const preview = useMemo(() => withPageSetup(pageSetupBase(), draft), [project, draft])`.
  It's memoized so new frame ids stay put between renders.
- It shows `allSpreads(preview)[index]` with `SpreadCanvas` (read-only, `guides`, `pad`),
  sized like the editor's stage, with ‹ › buttons, a folio label, "n / total", and ←/→
  (ignored while typing in a field, using `isTyping`).
- `index` is kept when switching between spreads and frames by mapping the photo's page: when
  the arrangement changes, go to the page that held the current spread's first page.
- Rulers are hidden in the preview (they'd measure the draft, which can't be edited there).

### New project's setup card (`Desk.tsx`)

It replaces `<PageSizeFields />` with the same `PageSettings`, holding its own draft, with
`showContent={false}` and no preview. The heading changes from "Layout" to "Page". Its help
text still points to Layout.

### Tour (`tour.ts`)

Layout step: "Choose spreads or frames, and inches or pixels, on the Page tab. Set the border
guides photos fit to, and drag guides out of the rulers, on the Guides tab." It opens the
Guides tab (the target is still `.modal.layout-editor`).

### Tests (step 2)

- `convertLayout.test.ts`:
  - `rearrange`: spreads → frames keeps size and unit, gives photos to the page holding
    their center, and a book → frames → book comes back with the same ids, items, and
    settings exactly.
  - `convertUnits`: 10 × 8 in at 300 → 3000 × 2400 px; a 0.5 in guide → 150 px; an item at
    x −9 in → −2700 px. px → in at 300: 1080 px → 3.6 in. A round trip comes back within
    1e-9.
- `pageSetup.test.ts` (from `pageSize.test.ts`; its five tests carry over with
  `applyPageSetup({ ...draftOf(p), page: { ...p.page, w } })`):
  - The draft that's already applied changes nothing.
  - Arrangement only: frames, same page size and unit; switching straight back restores the
    project (`toBe`).
  - Unit only: in → px multiplies; `pxPerUnit` becomes 1. px → in at a given dpi divides and
    sets `pxPerUnit`. Undo is one step.
  - dpi only: only `page.pxPerUnit` changes.
  - Unit and size together: `rescale` moves photos with the guides; `fixed` keeps the
    converted rects.
  - A preset is one undo step and sets all three.
  - A run computes from its start: in → px → in returns the same object; other edits between
    start a new run.
- `units.test.ts`: `presetOf` matches, and returns undefined for a custom size.
- `duplicate.test.ts`: the offset is `pageW / 40` for both units (0.25 on 10 in; 27 on 1080).
- Run everything, plus `npm run test:app`. e2e changes: `switchLayout('frames')` becomes
  `applyPageSetup({ arrangement: 'frames', page: { w: 1080, h: 1350, unit: 'px', pxPerUnit: 1 }, content: 'rescale' })`;
  `setWidth` as above. Add a check that switching back to spreads in inches restores the
  page width.

### Docs (step 2)

`docs/testing.md`: replace the [P]/[D]/[P≠D] tags with [S]/[F] (arrangement) and [in]/[px]
(unit), and rewrite the Layout section for the tabs, the draft, the preview, units, dpi,
Content, presets, and the setup card.

## Step 3: Exports for both arrangements

### Commits

1. The render plan (pure, tested) and the raster renderer. Images export for both
   arrangements, per spread or per page. Command, menu, and Preview changes.
2. PDF at real resolution.
3. Instagram from any document: slides, the picker, and the spreads warning. IDML in the
   document's unit.

### The render plan (`src/renderPlan.ts`)

```ts
/** One image an export makes: a whole spread, one page of it, or a frame. */
export interface OutputPage {
  spread: Spread;
  /** 'spread': all its pages side by side; else one page ('whole' for a frame). */
  part: 'spread' | PageSide;
}

/** The pages an export makes, in order: one per spread, or one per page (frames: one each). */
export function outputPages(project: Project, per: 'spread' | 'page'): OutputPage[];

/** A photo drawn onto an output page. */
export interface Draw {
  photoId: PhotoId;
  /** The part of the photo that shows, in its own upright pixels. */
  src: Rect;
  /** Where that part goes, in output pixels (inside the page). */
  dst: Rect;
  /** The whole placed photo, in output pixels, including what's off the page. */
  placed: Rect;
  z: number;
}

export interface PagePlan {
  /** The image's size in whole pixels. */
  pxW: number;
  pxH: number;
  /** Output pixels per unit actually used (the document's, or less). */
  pxPerUnit: number;
  /** Back to front. Photos entirely off the page are left out. */
  draws: Draw[];
}

/**
 * What to draw for an output page, in output pixels: each photo's visible part and where it
 * goes. Works for any arrangement and unit through pxPerUnit, so every renderer (images,
 * PDF, Instagram) shares it. `pxPerUnit` lowers the document's resolution (a proof, or
 * Instagram's sizes); it never raises it.
 */
export function planPage(
  page: OutputPage,
  sheet: Sheet,
  photos: Readonly<Record<PhotoId, PhotoMeta>>,
  pxPerUnit?: number,
): PagePlan;
```

This extends the proposal's `planPage(spread, sheet)`. It needs the photos' pixel sizes for
`src` and a part for per-page output, so `OutputPage` and `photos` are added.

- The region in spread coordinates: `part === 'spread'` → `{ x: spreadLeft, w: spreadWidth }`;
  else `pageRect(part, sheet)`.
- `k = min(sheet.pxPerUnit, pxPerUnit ?? Infinity)`. `pxW = round(region.w × k)`,
  `pxH = round(pageH × k)`.
- For each item, sorted by z: `placed = ((x − region.x) × k, y × k, w × k, h × k)`;
  `dst = placed ∩ (0, 0, pxW, pxH)`. Skip it if empty or its photo meta is missing.
  `src = (dst − placed.origin) × (photo.pxW / placed.w, photo.pxH / placed.h)`.
- `outputPages(project, 'page')` for spreads gives `first → right`, `middle → left, right`,
  `last → left`, in book order: the proposal's "torn into pages".

### Raster renderer (`src/rasterExport.ts`, replacing `frames.ts`)

```ts
/** An output page drawn on white from its plan; `missing` counts photos that couldn't be read. */
export async function renderPage(plan: PagePlan): Promise<{ canvas: OffscreenCanvas; missing: number }>;

/** Every output page as a JPEG, named in order. */
export async function renderImages(
  pages: readonly OutputPage[],
  project: Project,
  onProgress: (done: number) => void,
): Promise<{ files: ZipInput[]; missing: number }>;

/** File → Export images…: asks per spread or per page for spreads, then saves a ZIP. */
export async function exportImages(): Promise<void>;
```

- `renderPage` keeps today's `decode`: the whole photo decoded at `placed` size (bounded by its
  own pixels and `MAX_DECODE_PIXELS`), with `imageOrientation: 'from-image'`, then
  `drawImage(bitmap, src scaled to the bitmap, dst)`. It does not crop while decoding (see
  Questions, item 14).
- **Canvas limit**: if `pxW × pxH > MAX_CANVAS_PIXELS` (16,000,000), plan again at the largest
  `pxPerUnit` that fits, and say so after saving: "Pages were exported at 280 dpi, the most this
  browser can make in one image." (See Questions, item 8.)
- Names: per frame and per page, `01.jpg`, `02.jpg`, … (the page's number in the book). Per
  spread, the folio label with a hyphen: `01.jpg`, `02-03.jpg`, … `08.jpg`. ZIP name
  `${TERMS[arrangement].fileStem}-DATE.zip` (the Mac app's `suggestedName` already makes it
  "Trip (images).zip").
- Per spread or per page: for spreads, `exportImages` first calls `ask({ title: 'Export images',
message: 'One image for each spread, or for each page?', actions: [Cancel, One per spread,
One per page] })`. Frames skip the question.

### Commands, menus, Preview (step 3, commit 1)

- `commands.ts`: rename `exportFrames` → `exportImages` (`title: { browser: 'Export images…',
macos: 'Export Images…' }`, ⌘⇧E), running for any arrangement. `exportIndesign`: spreads
  only, any unit. `postToInstagram`: ready whenever Instagram is connected.
- `App.tsx`: the File menu always lists Save PDF and Export images, plus Export for InDesign
  for spreads. `instagramBlocked` loses the "Needs a digital project" cases.
- `menu.ts`: `images` is always enabled. `indesign.setEnabled(arrangement === 'spreads')`.
- `Preview.tsx`: the save button becomes "Export…" (in the Mac app too). It opens a dropdown
  with the File menu's export items, through the existing `FileMenu` component: Save PDF,
  Export images, Export for InDesign (spreads), and Post to Instagram (with its disabled note).
  While busy, it shows the progress text as today. `TERMS.save` goes.
- `e2e.ts`: `renderFrames` → `renderImages(outputPages(project, 'page'), …)`. Add a check in an
  inches spreads document (10 × 8 at 300): one per page gives 3000 × 2400 JPEGs in WebKit.

### PDF at real resolution (`src/pdf.ts`, new `src/pdfImage.ts`)

For each output page (one per spread, as today), `planPage(page, sheet, photos)`. Then, for
each draw:

1. **Needed pixels**: `need = placed size` (output pixels, already `min(own, placed × pxPerUnit)`
   for size, since `placed` is `w × k`). Clamp it to the photo's own size:
   `scale = min(1, need.w / photo.pxW)`.
2. **Pass-through**: read `readImageInfo` from the original's first 512 KB, as `indesign.ts`
   does. If the format is JPEG and `photo.pxW ≤ need.w × PASS_THROUGH_SLACK` (1.5), embed the
   original's bytes with `pdf.embedJpg`, drawn at `placed` (the page box crops). For an EXIF
   orientation other than 1, draw it inside
   `pushGraphicsState / concatTransformationMatrix(orientationMatrix(o, w, h)) / popGraphicsState`
   so it's upright. If `embedJpg` throws (an unusual JPEG), fall through to 3.
3. **Downsample**: `createImageBitmap(full, { imageOrientation: 'from-image', resizeWidth, resizeHeight, resizeQuality: 'high' })`
   at `need`. Draw only `src` onto an `OffscreenCanvas` of `dst` size, encode as JPEG at 0.92,
   `embedJpg`, and draw at `dst`. Only the visible part is embedded. If the original won't
   decode (HEIC outside Safari), use `img.thumb` as today and count it in `lowQuality`.
4. Positions in points: `pt = PT[unit] / plan.pxPerUnit` per output pixel. y flips as today.

```ts
// src/pdfImage.ts: pure, tested
/** The PDF matrix [a b c d e f] that draws an EXIF-oriented JPEG upright in a w × h box. */
export function orientationMatrix(
  orientation: number,
  w: number,
  h: number,
): [number, number, number, number, number, number];
/** Whether to embed the original as is: a JPEG not much larger than needed. */
export function passThrough(info: ImageInfo, photo: Pick<PhotoMeta, 'pxW'>, needW: number): boolean;
export const PASS_THROUGH_SLACK = 1.5;
```

After saving, if any photo used its preview, the notice says: "Some photos couldn't be read
at full size, so their previews were used."

### Instagram from any document (step 3, commit 3)

**Model** (`instagramImage.ts`, `instagramPost.ts`):

```ts
/** One image of a post: a frame, or one page of a spread. */
export type Slide = OutputPage; // part is never 'spread'

/** A slide as Instagram's JPEG: rendered from its plan at no more pixels than the post needs. */
export async function renderPostImage(
  slide: Slide,
  sheet: Sheet,
  photos: Project['photos'],
  layout: PostImageLayout,
): Promise<Blob | null>;

interface PostOptions {
  slides: readonly Slide[];
  sheet: Sheet;
  photos: Project['photos'];
  kind: PostKind;
  fit: Fit;
  caption: string;
  onStep: (step: PostStep) => void;
  signal?: AbortSignal;
}
```

- The page's size in output pixels, `{ w: pageW × pxPerUnit, h: pageH × pxPerUnit }`, goes to
  `postImageLayout` as today. An inches page at 300 dpi is 3000 × 2400, so the layout scales
  it down to 1440 wide.
- `renderPostImage` plans at `pxPerUnit' = min(pxPerUnit, pxPerUnit × layout.target.w / layout.source.w)`,
  so it never renders 3000 px only to shrink it. Then it draws the plan's canvas into the post
  image as today (scale is ≤ 1 there, or ≥ 1 for tiny pages, as today).
- Copy: "frame" → "slide" in `stepLabel`, errors ("There are no slides to post.", "Instagram
  posts up to 10 slides at a time."), and the Fit help ("Trims the sides of each slide.").
- `instagramPost.test.ts` mocks `./rasterExport` (`renderPage`) instead of `./frames`, and passes
  `slides`.

**Picker** (`InstagramPost.tsx`):

- `const all = outputPages(project, 'page')`, so frames give one slide each and spreads are
  torn into pages.
- `const [chosen, setChosen] = useState<Set<string>>(() => firstNonEmpty(all, LIMITS.maxItems))`,
  keyed `${spread.id}:${part}`. Selection keeps document order. Keys that no longer exist
  (undo while open) are dropped.
- A "Slides" section: a grid of small thumbnails, each a checkbox with the page's label (folio
  or frame number). Unchecked boxes are disabled once 10 are chosen, with help: "Instagram
  takes up to 10 at a time." A count: "4 of 10 chosen".
- For spreads, a warning above the grid: "Spreads are posted as their pages: 8 slides. Photos
  across the gutter continue onto the next slide."
- "Skip N empty frames" and "only the first 10 will be posted" go.
- `problem` becomes "Choose at least one slide." when none are chosen.
- The preview and thumbnails show one page of a spread with a `PageCanvas` helper. It wraps
  `SpreadCanvas` (`clip`) in an `overflow: hidden` box as wide as one page, shifted by that
  page's offset in the spread. It goes in `SpreadCanvas.tsx` so the picker and the preview
  share it.

```ts
/** firstNonEmpty(pages, n): the keys of the first n pages with photos, in order. */
export function firstNonEmpty(pages: readonly OutputPage[], n: number): Set<string>;
export function slideKey(p: OutputPage): string;
```

Both are pure, in `renderPlan.ts`, and tested.

### IDML in the document's unit (`src/idml.ts`)

- `PT` becomes `ptPerUnit(sheet) = sheet.unit === 'in' ? 72 : 1` (InDesign's 1 px = 1 pt).
- `ViewPreference` measurement units: `Inches` or `Pixels`.
- InDesign stays spreads only (frames: later, as the proposal says).

### Tests (step 3)

- `renderPlan.test.ts`:
  - `outputPages`: per spread and per page for a 4-spread book (6 pages: right, left, right,
    left, right, left), and frames.
  - `planPage`:
    - A 10 × 8 in spreads page at 300 dpi is 6000 × 2400 per spread, and 3000 × 2400 for one
      page.
    - A photo across the gutter shows on both pages with complementary `src` rects.
    - A photo hanging off the outside edge is cropped in `src` and `dst`.
    - Photos fully off are left out.
    - The `pxPerUnit` argument lowers the plan but never raises it.
    - Pixel frames at 1× match today's `renderFrame` rects.
    - z order is kept.
  - `firstNonEmpty` skips empty pages and stops at n. `slideKey` is unique.
- `pdfImage.test.ts`: all eight orientations map the unit square's corners correctly (a pure
  matrix check). `passThrough` is true for a JPEG within slack, false for PNG, HEIC/other, or
  a JPEG far larger than needed.
- `idml.test.ts`: a pixel spreads document writes 1 pt per px and Pixels rulers.
- `instagramImage.test.ts`: `postImageLayout` for an inches page in output pixels (3000 × 2400
  → 1440 wide).
- `instagramPost.test.ts`: slides in place of frames; the 10-slide limit message.
- `commands.test.ts`: `exportImages` replaces `exportFrames` (shortcut ⌘⇧E unchanged).
- By hand: a PDF of a book with full-size phone photos prints at the photos' own ppi (check in
  Preview.app's inspector, or with `pdfimages -list`). Rotated (orientation 6) and mirrored
  photos come out upright. A PNG and a HEIC (in Safari or the Mac app) embed. The PDF's size is
  reasonable.
- `npm run test:app`, with the e2e changes above.

### Docs (step 3)

`docs/testing.md`: Exports (images for both, per spread or per page, the canvas-limit notice,
PDF at full resolution), Preview's Export…, Instagram (slides, picker, spreads warning, inches
documents), and Mac menus (Export Images… always enabled).

## Step 4: Resolution

### Commits

1. The metric and the inspector.
2. Badges in the editor, the sidebar, and the Page tab's preview.
3. The summary before export.

### The metric (`src/resolution.ts`)

```ts
/**
 * Source pixels per output pixel the photo covers: 1 or more means enough detail for the
 * document's resolution. Measured on both axes, so a photo stretched by a free resize
 * counts its thinner side.
 */
export function coverage(
  photo: Pick<PhotoMeta, 'pxW' | 'pxH'>,
  item: Pick<Placement, 'w' | 'h'>,
  pxPerUnit: number,
): number;

/** Under this is a warning. A hair under 1 (rounding in fields) isn't. */
export const COVERAGE_MIN = 0.99;
export function isSoft(c: number): boolean;

/** What the inspector says: "240 ppi · below 300 dpi", or "Enlarged 120%". */
export function resolutionNote(photo: PhotoMeta, item: Placement, sheet: Sheet): { text: string; soft: boolean } | null;

/** Placed photos below the document's resolution, in book order. */
export function softPhotos(project: Project): { photoId: PhotoId; spreadId: SpreadId }[];
```

`coverage = min(photo.pxW / (item.w × pxPerUnit), photo.pxH / (item.h × pxPerUnit))`. This
extends the proposal's width-only formula; see Questions, item 2.

### Where it shows

- **Inspector** (`SpreadEditor.tsx`): replace both today's branches with `resolutionNote`.
  - Inches: always show `"{ppi} ppi"`, where `ppi = round(min(pxW / w, pxH / h))`. Add
    `" · below {dpi} dpi"` in the warn color when soft.
  - Pixels: `"Enlarged {round(100 / coverage)}%"`, only when soft.
  - The 200 ppi threshold goes. The dpi is the threshold now.
- **Editor badge**: in `renderItem`, a small warning mark in a corner of each soft photo
  (`.item .soft-badge`), with `title` set to the note.
- **Sidebar badge**: in `SpreadRow`'s head, a warning mark when any photo on that spread is
  soft, titled "2 photos below 300 dpi" (or "2 photos enlarged"). It's computed per row from
  the project.
- **Page tab preview**: `PagePreview` passes a `renderItem` that adds the same badge, computed
  against the draft's sheet. Going from 8 × 10 in to 16 × 20 in shows which photos go soft
  before Apply. The preview also lists the count: "3 photos would be below 300 dpi."

### Summary before export

```ts
/**
 * Before a PDF, images, or InDesign export: if photos are below the document's resolution,
 * ask whether to go on. Resolves true to export, false to stop (having opened the first one
 * in the editor for "Show me").
 */
export async function checkResolution(): Promise<boolean>;
```

- `ask({ title: 'Low resolution', message: '2 photos are below 300 dpi.', actions: [Show me, Export anyway (primary)] })`.
  In pixels: "2 photos are enlarged."
- **Show me**: closes the Preview if it's open, then sets `editingSpreadId` to the first soft
  photo's spread and selects that photo. Add `editorSelect: PhotoId | null` to `UiState`, read
  once by `SpreadEditor` as its initial `selected`, then cleared.
- Called at the start of `savePdf`, `exportImages`, and `exportIndesign`. Not Instagram (see
  Questions, item 10).

### Tests (step 4)

- `resolution.test.ts`:
  - `coverage` at 300 dpi: 3000 px over 10 in is 1, over 12 in is 0.83.
  - Pixels: a 1080 px photo over 1296 px is 0.83.
  - A stretched photo uses its thinner axis.
  - `isSoft` at 0.995 is false.
  - `resolutionNote` wording, for both units.
  - `softPhotos` order and ids.
  - Changing dpi in a draft changes the result.
- `project.test.ts`-style test for `checkResolution` (answering the `ask` as `project.test.ts`
  does): no dialog when nothing is soft; "Show me" sets the editor's spread and photo.
- Run everything. No e2e change.

### Docs (step 4)

`docs/testing.md`: the quality line in the editor section, badges, the Page preview's
warnings, and the summary before export.

## Migration and compatibility

- v3 → v4 is in step 1, as specified above. Placements and guides are already in the
  document's unit, so they're copied as they are. Old projects open looking exactly as they
  did. `schema.test.ts` holds v0–v3 samples.
- Projects are saved in IndexedDB and in `.photo-sequence` files. Both go through
  `migrateProject`, so both are covered.
- An older app (a cached web build before its update, or an older Mac build) opening a v4
  project shows "saved by a newer version", as for any bump. The web and Mac apps can skew for a
  while; that's accepted.

## Ordering and risks

- **Step 1 is all-or-nothing for the compiler.** The types, schema, validation, and every
  renamed site have to land in one commit. Keep it mechanical, with no behavior changes,
  so it's reviewable as a rename.
- **The live preview must match Apply.** Both use `withPageSetup(pageSetupBase(), draft)`.
  Don't let the preview compute from `projectStore.project` when a run is under way.
- **New spread ids in `withPageSetup`.** They make it impure. Memoize the preview on
  `(project, draft)`, and flip the preview by index, not id.
- **Step 2's Content choice depends on the size changing.** That's easy to get wrong in the
  form's enabled state. Test the "unit only" case (it must move nothing).
- **PDF memory grows with pass-through**: a whole 20 MB original for a photo mostly cropped
  off. pdf-lib holds everything in memory. Acceptable for books of normal length; step 5 is
  where streaming lives.
- **Step 4's stricter threshold** (300 instead of 200) will flag photos in existing books.
  That's intended. The release notes should say lowering the dpi is how to accept less.

## Questions / concerns

1. **Step 1 isn't quite invisible.** With `settings.sizes` dropped in v4, switching print ↔
   digital in step 1 can't return to the other format's last size; it uses the default
   (10 × 8 in or 1080 × 1350). Switching straight back still restores exactly. Is that
   acceptable for the step 1 → step 2 window, or should step 1 keep a session-only memory?
2. **Coverage on width only is wrong after a free resize.** Shift-resize can stretch a photo,
   so `pxW / w` and `pxH / h` differ. The plan uses the smaller of the two. OK?
3. **Which dpi converts.** in → px uses the document's dpi. But if the user edits the dpi and
   switches to pixels in the same draft, which wins? The plan uses the dpi as it was before
   the draft, since it can't be seen once pixels are picked. px → in uses the "Print at" value,
   which also becomes the document's dpi. Confirm both.
4. **"Keep photos relative to guides" moves into the draft.** It becomes Content (Rescale /
   Keep fixed). The plan keeps it saved as `settings.keepRelative`, written by Apply, so a
   document remembers its choice. Today it's a live checkbox that applies to later size
   changes. OK to make it part of the draft?
5. **Crossing units with a preset behaves differently from today.** Today, book → Instagram
   scales everything by width (a 0.5 in margin becomes 54 px). Per the proposal, it converts
   at 300 dpi (150 px) and then resizes, which clamps border guides but doesn't scale them.
   That leaves 150 px margins on a 1080 px frame. With Keep fixed, photos keep their
   300 dpi size and overflow the frame. Is that intended? Alternatives:
   - Rescale also scales guides when the unit changes.
   - Presets that cross units default to Rescale.
6. **Exactness of round trips.** `x × 300 / 300` isn't always bit-identical in floating
   point. "Straight back" is exact through the run base. Conversions that go elsewhere and back
   are only within 1e-9, and fields round for display. Fine?
7. **Pixel constants at large pixel sizes.** A converted 3000 × 2400 px page nudges 1 px,
   snaps to 10 px, and adds guides 25 px apart: all tiny there. The proposal derives only the
   duplicate offset from the page. Leave the rest as they are, or derive nudge, snap, and guide
   step from `pageW` in pixels too?
8. **The canvas limit before step 5.** Image export of inches documents can exceed about
   16.7 MP per image (an 11 × 17 in page at 300 dpi). The plan exports at the largest dpi that
   fits and says so. Alternatives: refuse with a message, or always fall back to per page.
   Which?
9. **Downsampling at export (Decision 2).** "Exports can downsample… for a quick proof", but
   the plan for step 3 doesn't name a control. The render plan supports a lower `pxPerUnit`;
   should step 3 add a Resolution field when exporting (at most the document's), or does
   lowering the document's dpi cover it for now?
10. **The pre-export summary and Instagram.** Instagram posts at most 1440 px wide, so the
    document's 300 dpi isn't the right bar there. The plan skips the summary for Instagram.
    Should Instagram check coverage against the posted size instead?
11. **Draft warnings belong to step 4.** The proposal lists them under the Page tab (step 2),
    but the metric arrives in step 4. The plan adds them to the preview in step 4.
12. **The draft and the Guides tab.** The plan keeps a pending draft across tab switches. The
    Guides tab always edits the current page; the Page tab's preview is read-only and picks up
    guide edits. Should switching tabs, or editing a guide, drop the draft instead?
13. **Content when it can't matter.** Rescale/Keep fixed changes nothing unless the size
    changes. The plan disables it then; the proposal shows it always. Disable, hide, or always
    enable?
14. **Cropping while decoding.** The proposal's plan "crops off-page parts before decoding".
    Browsers disagree on whether `createImageBitmap`'s crop rect is taken before or after EXIF
    orientation. Step 3 keeps today's whole-photo decode at placed size and crops when drawing.
    Leave true crop-before-decode to step 5?
15. **Pass-through threshold.** "Close to the right size" is 1.5× in the plan
    (`PASS_THROUGH_SLACK`). Too generous makes big PDFs; too strict re-encodes most photos.
    Also, progressive or CMYK JPEGs may not embed through pdf-lib. They fall back to
    re-encoding, which is fine but slower.
16. **Pixel spreads and InDesign.** The proposal ticks InDesign for spreads. With pixel spreads
    possible, the plan writes 1 pt per px and Pixels rulers. Frames stay without InDesign.
    Agreed?
17. **Export… in Preview.** "The same choices as the File menu" is read as a dropdown of the
    File menu's export items. Per spread or per page is a follow-up question for spreads. Or
    should it be one Export dialog (format, per spread or page, resolution) that the File menu
    items open too?
18. **"Slides" preset.** 13.33 × 7.5 in isn't exactly 16:9 (13.333…), and gives 3999 × 2250 px
    at 300 dpi. `UNITS.in.round` keeps hundredths, so 13.333 would display as 13.33 anyway.
    Accept 13.33?
19. **Image names per spread.** `02-03.jpg` for a spread, `01.jpg`/`08.jpg` for the single
    pages. OK, or always number them `01.jpg`… in order?

## Answers (review)

1. Fine. Steps 1–4 land together on one branch, so the gap never ships.
2. Yes, the thinner axis.
3. Confirmed: in → px at the dpi before the draft; px → in at "Print at", which becomes the dpi.
4. Yes, Content is part of the draft, saved as `settings.keepRelative`.
5. When the unit changes, **Rescale** scales border and line guides by the page's width (as today's `convertLayout` does) before moving photos with them. **Keep fixed** keeps the converted guides and photos, clamped to the page. Book → Instagram 4:5 with Rescale then gives 54 px margins, as today.
6. Fine.
7. Leave the constants as they are.
8. Export at the largest dpi that fits, and say so.
9. No control in step 3. The render plan takes a lower `pxPerUnit`, and lowering the document's dpi covers it for now.
10. Skip Instagram in the summary.
11. Agreed, in step 4.
12. Keep the draft across tabs.
13. Disable it.
14. Yes, leave it to step 5.
15. 1.5× to start. The fallback is fine.
16. Agreed.
17. A dropdown of the File menu's export items.
18. 13.33 is fine.
19. `02-03.jpg` for spreads.
