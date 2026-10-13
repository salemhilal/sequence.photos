# Proposal: spreads or frames, inches or pixels

Status: proposal, for discussion. Nothing here is implemented yet.

## Summary

Replace the single choice of print or digital with two independent ones:

- **Arrangement:** spreads (facing pages; the book opens on a single right page and closes on a single left page) or frames (single pages in order).
- **Unit:** inches or pixels, plus a **resolution** in dpi (300 by default).

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
  /** Output pixels per inch: the export resolution for inches, and the print size for pixels. */
  dpi: number;
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

/** The one conversion: document units to output pixels. */
const pxPerUnit = (p: PageSetup) => (p.unit === 'px' ? 1 : p.dpi);
```

`Sheet` gains `arrangement`, `unit`, and `pxPerUnit`, and loses `layout`. Placements, guides, and the desk don't change at all.

### Why not one canonical unit?

The alternative is to store everything in one unit (inches, points, or output pixels) and convert only for display. That makes unit switches free. It also has costs:

- **What's "true" depends on the unit.** In an inches project, the physical size is the truth, and the dpi decides how many pixels you get. In a pixels project, 1080 × 1350 is the truth, and the dpi barely matters (it only sets the PDF's physical size). With canonical storage, changing a pixel project's dpi must either rescale everything stored, or change its pixel size, which is the one number its user cares about. Storing in the document's unit means a dpi change never touches stored data, in either unit.
- **Exactness.** A pixel project wants whole pixels, and an inches project wants eighths. As inches, 1080 px is 3.6 at 300 dpi but 11.25 at 96. Snapping, nudging, and rounding (`units.round`) would all convert on every edit, and drift would show up as 1079.9999 in fields.
- **Not much simpler.** Geometry would still need unit-aware constants (a 1 px nudge is 1/300 in), so `UNITS` wouldn't go away.

### Why not two systems?

That's today's design, and it's where feature parity drifts: each kind has its own constants, terms, exports, and warnings. With `pxPerUnit`, everything that cares about pixels, meaning warnings and exports, gets one number, and everything else ignores the unit.

### Physical units beyond inches

mm or cm later would be display units over inches (store inches, show mm). `Unit` stays "physical or pixel". This doesn't need a decision now.

## Switching

| Change                             | What happens to stored data                                                                                   | Notes                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Arrangement** (spreads ↔ frames) | Re-paginate only: each page becomes a frame, or frames pair into spreads. **Same page size, same unit.**      | Today's `convertLayout` minus the `k` scale. `lastSwitch` still restores exactly when switching straight back. |
| **Unit** (in ↔ px)                 | Multiply (in → px) or divide (px → in) every stored size, position, and guide by the dpi. Same physical size. | 10 × 8 in at 300 dpi becomes 3000 × 2400 px. Don't round when converting, so a round trip is exact.            |
| **Resolution** (dpi)               | Nothing.                                                                                                      | Warnings and export sizes change. For pixels, the PDF's physical size changes.                                 |
| **Page size**                      | As today (`setPageSize`, `relayoutRect`).                                                                     | Unchanged.                                                                                                     |
| **Preset**                         | Sets the arrangement, unit, and size at once, as one undo step.                                               | See UI below.                                                                                                  |

`settings.sizes` (each kind's remembered size) goes away, because arrangements share the page size. A 5.5 × 8.5 in zine is still 5.5 × 8.5 in after switching to frames.

## Resolution warnings

There is one metric for every document: **how many source pixels the photo has, per output pixel it covers.**

```ts
coverage = photo.pxW / (item.w * pxPerUnit(page)); // ≥ 1: enough detail
```

`item.w` is the photo's whole placed width, including any part hanging off the page, so cropping is accounted for automatically.

The wording depends on the unit, but the math doesn't:

|         | Inches (dpi 300)                    | Pixels                      |
| ------- | ----------------------------------- | --------------------------- |
| Shows   | Effective ppi: `photo.pxW / item.w` | Enlargement: `1 / coverage` |
| Fine    | ≥ 300 ppi (coverage ≥ 1)            | ≤ 100%                      |
| Notice  | 200–299 ppi: "Below 300 dpi"        | 101–150%: "Enlarged 120%"   |
| Warning | < 200 ppi: "May print soft"         | > 150%: "May look soft"     |

The thresholds are relative to the target (notice below 1, warning below ⅔). They match today's 200 ppi print warning at 300 dpi, and they quiet today's digital warning, which fires at any enlargement over 100%.

**Where warnings show up:**

- In the inspector, as today.
- As a small badge on the photo in the editor and on its spread's thumbnail in the sidebar.
- As a one-line summary before export: "2 photos are below 300 dpi. Export anyway / Show me."

**Too much detail** is not worth warning about, because exports downsample. The only case where it matters is file size: Instagram's 8 MB limit, and memory for very large books. Exports handle both on their own, so the proposal is not to flag it in the UI.

## One editing flow

- **`UNITS` keyed by unit, `TERMS` keyed by arrangement.** A frames document in inches says "frames" and "in". A spreads document in pixels says "spreads" and "px". No combination needs its own code.
- **Unit-specific constants derived from the page where they're relative.** For example, the duplicate offset already uses `pageW / 10` for pixels. Use it for both units, so one rule works at 1080 px and at 3000 px.
- **Exports offered by what they need, not by kind:**

| Export                 | Spreads | Frames | Notes                                                                                                                               |
| ---------------------- | ------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| PDF                    | ✓       | ✓      | Already works for both. Points per unit: 72 for inches, 72 / dpi for pixels.                                                        |
| Images (JPEG per page) | ✓       | ✓      | Renders at `w × pxPerUnit`. For spreads: one image per spread, or per page (a choice in the dialog). Covers slides and zine proofs. |
| InDesign               | ✓       | Later  | IDML supports non-facing pages. It's a small addition once the units are handled.                                                   |
| Instagram              | —       | ✓      | Any unit, because `postImageLayout` already scales to Instagram's sizes.                                                            |

The Preview's save button becomes "Export…", with the same choices as the File menu.

### Layout panel

```
Pages        [ Spreads | Frames ]
Size         [ 10 ] × [ 8 ]  [ in ▾ ]      Presets ▾
Resolution   [ 300 ] dpi                    (inches only; Advanced for pixels)
             [ Revert ]  [ Apply ]
```

Presets set all three at once, which covers most people:

- **Book:** 10 × 8 in spreads
- **Zine:** 5.5 × 8.5 in spreads
- **Slides:** 13.33 × 7.5 in frames
- **Square book:** 8 × 8 in spreads
- **Instagram 4:5:** 1080 × 1350 px frames
- The other Instagram sizes, as today

Pixel spreads are allowed, because blocking them would cost code, but no preset offers them.

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

| v3                                       | v4                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `layout.kind: 'print'`, `layout.page`    | `layout.kind: 'spreads'`, `page: { ...layout.page, unit: 'in', dpi: 300 }` |
| `layout.kind: 'digital'`, `layout.frame` | `layout.kind: 'frames'`, `page: { ...layout.frame, unit: 'px', dpi: 300 }` |
| `settings.sizes`                         | Dropped                                                                    |

Placements and guides are already stored in the document's unit, so they don't change. Projects open looking exactly as they did. Older versions of the app see v4 as "made by a newer version", as they do today.

## Plan

Each step is its own PR, and the app works after each one:

1. **Model.**
   - Make schema v4 and the type renames (`print` → `spreads`, `digital` → `frames`), and move the size into `page`.
   - Add `pxPerUnit`, key `UNITS` by unit and `TERMS` by arrangement.
   - No visible change: the arrangement and unit still move together.
2. **Separate the axes.**
   - Switching arrangement no longer changes the unit.
   - Add switching units, the new Layout panel, and presets.
3. **Exports for both arrangements.**
   - Add the render plan.
   - PDF and Images for both arrangements.
   - PDF at real resolution.
4. **Resolution.**
   - The coverage metric, badges, and the summary before export.
5. **Large exports.**
   - Tiled export with a streaming encoder on the web, and native rendering on the Mac. Only when needed.

## Open questions

- **Spreads as images:** one image per spread, per page, or a choice?
- **Instagram from inches documents:** allow it, as long as they're frames (render at dpi, then scale)? It's free with the render plan.
- **Pixels and dpi:** default 300 (so a 1080 px frame prints at 3.6 in), or 72, to keep today's PDF sizes for pixel documents?
- **Flagging too much detail:** confirm that "too big" only needs handling at export time, and doesn't need a warning in the UI.
