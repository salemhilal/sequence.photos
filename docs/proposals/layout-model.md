# Proposal: spreads or frames, inches or pixels

Status: agreed. Steps 1–4 are implemented (see [layout-model-plan.md](layout-model-plan.md)); step 5 isn't.

## Decisions

1. **Users pick two things, independently:** spreads or frames, and inches or pixels. This replaces print or digital.
   - Spreads are facing pages: the book opens on a single right page and closes on a single left page.
   - Frames are single pages in order.
2. **Resolution is part of the document.** That means dpi for inches (300 by default) and pixel density for pixels (1× by default).
   - Exports use it to decide how many pixels to produce.
   - Exports can downsample to a lower dpi or density, for example a quick proof, but never go above it.
   - Eventually, the editor warns when a photo doesn't have enough pixels for it.
3. **Converting between inches and pixels follows a conversion:** multiply or divide by the document's dpi. When the size changes too, the user decides what the content does:
   - **Rescale it to match the layout:** photos move and scale with the guides, as "keep relative" does today.
   - **Keep it fixed:** photos keep their converted size and position, so how each photo is scaled, and its resolution, stays the same.

   Pixels → inches asks which dpi to print at, 300 by default.

4. **One warning,** when a photo has less detail than the document's resolution asks for. Too much detail is handled only at export, by downsampling.
5. **Every combination is allowed,** pixel spreads included. Presets just don't offer pixel spreads.
6. **Instagram takes spreads too,** torn into their pages as slides, with a warning. Inches documents post by rendering at the dpi, then scaling down.
7. **Exporting spreads as images** offers one image per spread or one per page.
8. **mm and cm come later.**
9. **The Layout view has two tabs.**
   - **Page** holds everything that waits for Apply: spreads or frames, size and unit, dpi, and whether content rescales or stays fixed. It has a live preview.
   - **Guides** holds everything that applies right away, as today.
10. **The dpi is set alongside the page settings,** wherever those appear. Lowering it is how someone says lower detail is fine: warnings only fire below the dpi they chose.
11. **New projects get every page setting.** The setup card on a new project's empty desk shows the same Page settings as the Layout view's Page tab, using the same component.
12. **Instagram: pick which slides to post.** The API takes 10 at most, so the post pane lets people choose up to 10, for example leaving out a book's first or last page.

## Summary

Keep **one geometry**. Store sizes and positions in the document's own unit, as today. Add **one bridge number**, `pxPerUnit`: the dpi for inches, and 1 for pixels. That number maps any document onto a shared **output-pixel space**. Resolution warnings and every exporter work in that space, so they don't need to know which unit the document uses.

So the answer to "one shared coordinate system, or two with a conversion" is both, at different layers:

- **Editing** happens in the document's unit. It is the one the user typed, so it stays exact.
- **Image quality** is judged in output pixels, through one multiplication.
- Switching unit is an explicit, one-time conversion of the stored numbers, using the dpi.

Most of today's print/digital branches are really about the arrangement, and they map onto spreads/frames one to one. The few that are really about units collapse into `pxPerUnit`. The one thing that stays special is Instagram, which needs frames.

## What we have today

`Layout = PrintLayout | DigitalLayout`. The kind decides three things at once: the structure (first/middle/last spreads, or frames), the unit (inches or pixels), and the outputs (PDF and InDesign, or JPEG frames and Instagram). About 25 files branch on it:

| What the branch is really about               | Where                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arrangement:** facing pages vs single pages | `spreads.ts` (`allSpreads`, `sheetOf`), `geometry.ts` (`pageSides`, `sideAt`, `sheetExtent`), `actions.ts` (insert, add spread, folio labels), `convertLayout.ts`, `Sidebar.tsx`, `LayoutEditor.tsx` (mirrored), `validate.ts`, `schema.ts`, `TERMS` (spread/frame, inside/outside vs left/right, counts) |
| **Unit:** inches vs pixels                    | `UNITS` (nudge, snap, minimum sizes, rounding, suffix), `pdf.ts` (`PT`), `SpreadEditor.tsx` (ppi vs "Enlarged"), `actions.ts` (duplicate offset), `convertLayout.ts` (the `k` scale), `settings.sizes`                                                                                                    |
| **Output:** which exports are offered         | `commands.ts`, `Preview.tsx` (save button), `platform/macos/menu.ts`, `frames.ts`, `instagramPost.ts`                                                                                                                                                                                                     |

Two things stand out:

1. **The geometry is already unit-agnostic.** `relayoutRect`, `resizeRect`, `borderBox`, `fitCentered`, and the rest take numbers. Only the `UNITS` constants differ. The split was never deep. It's just tangled with the arrangement.
2. **Today's PDF embeds the 1,400 px preview, not the original** (`pdf.ts` uses `img.thumb`). A photo across a 10 in page prints at no more than 140 ppi, even when the inspector says it has 400. This is the biggest quality problem we have, and it's independent of this proposal. It's covered under High-quality export below.

## The model

```ts
type Arrangement = 'spreads' | 'frames';
type Unit = 'in' | 'px';

interface PageSetup {
  /** One page's size (a spread is two of them), in `unit`. */
  w: number;
  h: number;
  unit: Unit;
  /**
   * Output pixels per unit: the export target, saved with the document so warnings can
   * check against it while editing. The dpi for inches (300 by default). 1 for pixels
   * (not shown yet; a 2× option would set 2).
   */
  pxPerUnit: number;
}

interface SpreadsLayout {
  kind: 'spreads';
  firstSpread;
  spreads;
  lastSpread;
} // today's PrintLayout
interface FramesLayout {
  kind: 'frames';
  frames: [Frame, ...Frame[]];
} // today's DigitalLayout

interface Project {
  schemaVersion: 4;
  page: PageSetup; // replaces layout.page / layout.frame and settings.sizes
  layout: SpreadsLayout | FramesLayout;
  // photos, pile, settings (minus sizes), nextZ: unchanged
}
```

`page.pxPerUnit` is the one conversion: document units to output pixels. Exports use it to decide how many pixels to make, and warnings use it to decide how many each photo needs. An export can lower it (a quick 72 dpi proof) but not raise it, since raising it would only upscale photos. The editor checks against the saved one.

The dpi never changes the layout: changing it moves and resizes nothing. It decides geometry only at the moment of switching units (see Switching).

`Sheet` gains `arrangement`, `unit`, and `pxPerUnit`, and loses `layout`. Placements, guides, and the desk don't change at all.

### Why not one canonical unit?

The alternative is to store everything in one unit (inches, points, or output pixels) and convert only for display. That makes unit switches free. It also has costs:

- **What's "true" depends on the unit.** In an inches project, the physical size is the truth, and the dpi decides how many pixels you get. In a pixels project, 1080 × 1350 is the truth, and it has no physical size at all. With canonical storage, a pixel project would need a dpi just to be stored, and changing it would either rescale everything or change its pixel size, which is the one number its user cares about. Storing in the document's unit means a dpi change never touches stored data.
- **Exactness.** A pixel project wants whole pixels, and an inches project wants eighths. As inches, 1080 px is 3.6 at 300 dpi but 11.25 at 96. Snapping, nudging, and rounding (`units.round`) would all convert on every edit, and drift would show up as 1079.9999 in fields.
- **Not much simpler.** Geometry would still need unit-aware constants (a 1 px nudge is 1/300 in), so `UNITS` wouldn't go away.

### Why not two systems?

That's today's design, and it's where feature parity drifts: each kind has its own constants, terms, exports, and warnings. With `pxPerUnit`, everything that cares about pixels, meaning warnings and exports, gets one number, and everything else ignores the unit.

### How InDesign does it

InDesign stores everything in points (1/72 in), and "pixels" there is only a ruler unit fixed at 1 px = 1 pt. Its layout has no resolution: placed images keep their own pixels, and output resolution is chosen at export (PDF downsampling, or a ppi for JPEG/PNG export), with preflight warning about images below a minimum effective resolution. Ours works the same way, except the target is saved with the document so warnings show while editing. When we write points (PDF, IDML), pixel documents use InDesign's 1 px = 1 pt, so they open in InDesign at the same pixel size.

### Physical units beyond inches

Later. mm and cm would be display units over inches (store inches, show mm), so `Unit` stays "physical or pixel".

## Switching

| Change                             | What happens to stored data                                                                                   | Notes                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arrangement** (spreads ↔ frames) | Re-paginate only: each page becomes a frame, or frames pair into spreads. **Same page size, same unit.**      | Today's `convertLayout` minus the `k` scale. `lastSwitch` still restores exactly when switching straight back.                                                                          |
| **Unit** (in ↔ px)                 | Multiply (in → px) or divide (px → in) every stored size, position, and guide by the dpi. Same physical size. | 10 × 8 in at 300 dpi becomes 3000 × 2400 px. Pixels → inches asks "Print at ___ dpi", 300 by default (1080 px at 300 is 3.6 in). Don't round when converting, so a round trip is exact. |
| **Resolution** (dpi)               | Nothing.                                                                                                      | Warnings and export sizes change.                                                                                                                                                       |
| **Page size**                      | As today (`setPageSize`, `relayoutRect`).                                                                     | Unchanged.                                                                                                                                                                              |
| **Preset**                         | Sets the arrangement, unit, and size at once, as one undo step.                                               | See UI below.                                                                                                                                                                           |

`settings.sizes` (each kind's remembered size) goes away, because arrangements share the page size. A 5.5 × 8.5 in zine is still 5.5 × 8.5 in after switching to frames.

## Resolution warnings

There is one metric for every document: **how many source pixels the photo has, per output pixel it covers.**

```ts
coverage = photo.pxW / (item.w * pxPerUnit(page)); // ≥ 1: enough detail
```

`item.w` is the photo's whole placed width, including any part hanging off the page, so cropping is accounted for automatically.

The wording depends on the unit, but the math doesn't:

|         | Inches (dpi 300)                         | Pixels                      |
| ------- | ---------------------------------------- | --------------------------- |
| Shows   | Effective ppi: `photo.pxW / item.w`      | Enlargement: `1 / coverage` |
| Warning | Below the dpi: "240 ppi · below 300 dpi" | Over 100%: "Enlarged 120%"  |

There is a single warning, whenever coverage is below 1: the photo has less detail than the document's resolution asks for. In pixels this is today's behavior. In inches it's stricter than today's 200 ppi threshold, which is the point: the dpi says what "enough" means.

**Where warnings show up:**

- In the inspector, as today.
- As a small badge on the photo in the editor and on its spread's thumbnail in the sidebar.
- As a one-line summary before export: "2 photos are below 300 dpi. Export anyway / Show me."

**Too much detail** is handled only at export: exports downsample to the target, which also covers Instagram's 8 MB limit and memory for very large books. Nothing is flagged while editing.

## One editing flow

- **`UNITS` keyed by unit, `TERMS` keyed by arrangement.** A frames document in inches says "frames" and "in". A spreads document in pixels says "spreads" and "px". No combination needs its own code.
- **Unit-specific constants derived from the page where they're relative.** For example, the duplicate offset already uses `pageW / 10` for pixels. Use it for both units, so one rule works at 1080 px and at 3000 px.
- **Exports offered by what they need, not by kind:**

| Export                 | Spreads | Frames | Notes                                                                                                                                  |
| ---------------------- | ------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| PDF                    | ✓       | ✓      | Already works for both. Points per unit: 72 for inches, 1 for pixels (InDesign's convention).                                          |
| Images (JPEG per page) | ✓       | ✓      | Renders at `w × pxPerUnit`. For spreads, the export dialog offers one image per spread or one per page. Covers slides and zine proofs. |
| InDesign               | ✓       | Later  | IDML supports non-facing pages. It's a small addition once the units are handled.                                                      |
| Instagram              | ✓       | ✓      | Any unit: inches render at the dpi, then `postImageLayout` scales to Instagram's sizes. Spreads are torn into their pages (below).     |

The Preview's save button becomes "Export…", with the same choices as the File menu.

**Spreads on Instagram** are torn into their pages: each page becomes a slide, in book order (the first and last single pages are one slide each, a spread two). A photo across the gutter continues from one slide to the next, which suits sequences meant to cross pages. The post pane warns before posting, for example: "Spreads are posted as their pages: 8 slides. Photos across the gutter continue onto the next slide." The 10-slide limit counts pages, not spreads, and each page's shape must be within Instagram's 4:5 to 1.91:1.

**Choosing slides.** Instagram's API takes 10 at most, for a carousel or a run of stories. Today the post pane posts the first 10 and has a "Skip empty frames" checkbox. Instead, it shows every page or frame as a thumbnail with a checkbox:

- By default, the first 10 that aren't empty are selected.
- Selecting an 11th isn't possible, and the pane says why.
- Order follows the document.

This replaces both "Skip empty frames" and the "only the first 10 will be posted" warning, and lets people leave out a book's first or last page, or post a run from the middle.

### Layout view: Page and Guides tabs

Settings that wait for Apply and settings that apply right away live in separate tabs, so it's always clear which is which:

```
[ Page | Guides ]

Page tab                                        Guides tab
  Pages        [ Spreads | Frames ]               Border guides, line guides,
  Size         [ 10 ] × [ 8 ]  [ in ▾ ]  Presets ▾  centering, drop guide: as today.
  Resolution   [ 300 ] dpi                        Every change applies right away
  Content      (•) Rescale with layout             and is its own undo step.
               ( ) Keep fixed
               [ Revert ]  [ Apply ]
```

- **Resolution is always next to the size.** In inches it's the dpi: what exports produce and what warnings check against. Someone who's fine with 150 dpi sets 150 and gets no warnings above it. In pixels it's the pixel density, fixed at 1× until there's a reason to offer more. When switching pixels → inches, the dpi field is how the conversion asks "Print at ___ dpi" (300 by default).
- **A new project's empty desk** shows the same Page settings in its setup card, using the same component. There's no preview there, since nothing is placed yet.

**The Page tab is a draft, with a live preview.** Changing any of these leaves the document alone and shows, beside the form, the document's real spreads or frames as they'd look after Apply: photos re-paginated, converted, and moved with the guides. ‹ › (and the arrow keys) flip through them, as spreads or frames, whichever is selected. Apply makes the whole change one undo step; Revert drops the draft.

- **Convert with or without resizing.** Switching the unit fills the size fields with the converted size (3000 × 2400). Apply as is converts. Edit the size or pick a preset first, and it converts and resizes in one step. A choice beside the size picks what the content does: **Rescale with the layout** (photos move and scale with the guides, today's "keep relative") or **Keep fixed** (photos keep their converted size and position, so their resolution doesn't change). The preview shows whichever is chosen.
- **It's cheap.** The preview is the same pure functions Apply runs (re-paginate, convert units, `relayoutRect`), on a copy of the project, drawn with `SpreadCanvas` read-only. Nothing is decoded beyond the previews already shown.
- **With no draft**, the stage shows guides on an empty page as today. Guide edits on the Guides tab always apply right away. When a Page draft is pending, the preview shows the guides too.
- The preview also shows resolution warnings for the draft, so going from 8 × 10 in to 16 × 20 in shows which photos would go soft before applying.

Presets set all three at once, which covers most people:

- **Book:** 10 × 8 in spreads
- **Zine:** 5.5 × 8.5 in spreads
- **Slides:** 13.33 × 7.5 in frames
- **Square book:** 8 × 8 in spreads
- **Instagram 4:5:** 1080 × 1350 px frames
- The other Instagram sizes, as today

Spreads or frames, and inches or pixels, are just two layout settings, so every combination works, including pixel spreads. Presets only cover the common ones, and none of them is pixel spreads.

## High-quality export

What the limits actually are:

- **Canvas area:** Safari limits a canvas to about 16.7 MP (for example 4096²), and its total canvas memory is limited too. Today's frame export draws a whole page on one canvas. That's fine at 1080 × 1350, but an 11 × 17 in page at 300 dpi is 3300 × 5100 = 16.8 MP, which is already over. So once inches documents can export images, the limit becomes real.
- **Decoding:** `createImageBitmap` with `resizeWidth`/`resizeHeight` decodes straight to the needed size (we already do this), so memory stays bounded. Whether Safari refuses to decode very large originals is unverified.
- **PDF:** pdf-lib keeps the whole document in memory. Embedding many 20 MB originals in a long book could use hundreds of MB.

Proposal, in order of value:

1. **A render plan, separate from the renderers.** A pure function turns a page into what to draw:

   ```ts
   planPage(spread, sheet) → { pxW, pxH, draws: [{ photoId, src: Rect /* photo px */, dst: Rect /* output px */, z }] }
   ```

   It works in output pixels (via `pxPerUnit`) and computes each photo's visible source rectangle, which crops off-page parts before decoding. Canvas export, PDF, IDML, Instagram, and a future native renderer all consume the same plan. It's also easy to test, because it involves no images.

2. **PDF embeds real resolution.**
   - For each draw, embed the photo at `min(own pixels, dst × target resolution)`.
   - If the original is a JPEG that is already the right size or close to it, pass its bytes straight through. That means no decode and no canvas, so the 16 MP limit doesn't apply, and only EXIF orientation needs a transform.
   - Otherwise, downsample through a canvas. One photo at its printed size is almost always under 16 MP; a full 20 × 8 in spread at 300 dpi is 14.4 MP.
   - Crop with the page box as today. Flush each page's images to keep memory down if needed.
   - This fixes today's 140 ppi ceiling.

3. **Tiled raster export when a page is over the canvas limit.**
   - Render the plan in horizontal bands of 4096 px or less. Each band draws only the parts of photos it crosses, using `drawImage` source rects.
   - Feed the bands to a streaming encoder: PNG is simple to stream, and JPEG works with a scanline WASM encoder such as mozjpeg.
   - This removes the page-size limit on the web, at the cost of one dependency, loaded only when needed.

4. **Native rendering in the Mac app.**
   - Add a `platform.renderPage(plan)` that hands the plan to Rust (the `image` crate, or Core Graphics). It reads originals from disk and has no canvas limits.
   - The web keeps step 3 as its fallback.
   - The plan is the contract between them, so the two can't drift apart.

Steps 1 and 2 are worth doing even if the rest of this proposal waits.

## Migration (schema 3 → 4)

| v3                                       | v4                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `layout.kind: 'print'`, `layout.page`    | `layout.kind: 'spreads'`, `page: { ...layout.page, unit: 'in', pxPerUnit: 300 }` |
| `layout.kind: 'digital'`, `layout.frame` | `layout.kind: 'frames'`, `page: { ...layout.frame, unit: 'px', pxPerUnit: 1 }`   |
| `settings.sizes`                         | Dropped                                                                          |

Placements and guides are already stored in the document's unit, so they don't change. Projects open looking exactly as they did. Older versions of the app see v4 as "made by a newer version", as they do today.

## Plan

Each step is its own PR, and the app works after each one:

1. **Model.**
   - Make schema v4 and the type renames (`print` → `spreads`, `digital` → `frames`), and move the size into `page`.
   - Add `pxPerUnit`, key `UNITS` by unit and `TERMS` by arrangement.
   - No visible change: the arrangement and unit still move together.
2. **Separate the axes.**
   - Switching arrangement no longer changes the unit.
   - Add switching units (with Rescale or Keep fixed), the dpi field, and presets.
   - Split the Layout view into Page and Guides tabs. The Page tab is a draft with a live preview you can flip through.
   - The new project's setup card uses the same Page settings.
3. **Exports for both arrangements.**
   - Add the render plan.
   - PDF and Images for both arrangements, with one image per spread or per page.
   - PDF at real resolution.
   - Instagram from spreads (torn into pages) and from inches, with a picker for the slides to post.
4. **Resolution.**
   - The coverage metric, badges, and the summary before export.
5. **Large exports.**
   - Tiled export with a streaming encoder on the web, and native rendering on the Mac. Only when needed.

## Open questions

None for now.
