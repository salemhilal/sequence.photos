# Proposal: color and print-quality export

What Sequence needs so that a future **Print** export (a PDF for a professional printer or a
print-on-demand service, or ordering a book straight from the app) is professional and high
quality. Research only: nothing here is built yet.

## 1. Summary

Today's PDF has the right pixels: since the render plan, photos go in at real resolution.
It doesn't have the right **color**, and it isn't a print file. It has no bleed, no trim box,
no output intent, and no color profiles. Every image is declared plain `DeviceRGB`, so a
printer has to guess what its RGB numbers mean.

The worst part is that the color is inconsistent. The same iPhone photo comes out two ways,
depending on how large it's placed:

- When it's passed through as its original JPEG, it keeps its Display P3 numbers but loses
  the meaning of those numbers, so it prints dull.
- When it's re-encoded, the browser converts it to sRGB, so it prints about right.

**Recommendation: stay in RGB, tag everything, and let the printer convert (option a).**
Write PDF/X-4 files in which every image carries its own ICC profile (sRGB, Display P3,
Adobe RGB, as shot), with bleed and trim boxes and an output intent for the target press.
This is what most print-on-demand services ask for or accept, and it can be done in the
browser with pdf-lib's low-level API, with no new heavy dependency. Here is what services
ask for:

- Lulu: "sRGB with a GRACoL ICC profile" ([Lulu](https://help.api.lulu.com/en/support/solutions/articles/64000254609-pdf-creation-settings)).
- Gelato: PDF/X-4 with sRGB and a GRACoL 2006 output intent ([Gelato](https://support.gelato.com/en/articles/8996349)).
- Peecho: RGB ([Peecho](https://www.peecho.com/print-api)).
- Mixam: takes RGB and converts it ([Mixam](https://mixam.co.uk/support/checklist)).

Converting to CMYK ourselves (option b) is only worth it for offset printers who demand
PDF/X-1a. If we ever do it, it should be Mac-only and come later.

Ordering through a print-on-demand API (option c) is the most valuable end state. It needs
our server, payments, and a cover, so it comes last. Lulu's Print API is the best first
partner.

The smallest valuable step is a bug fix with no UI: **tag every image in today's PDF with
its color profile, so color is the same whichever path a photo takes.**

## 2. What happens to color today

Step by step, verified against the code.

### Import: `src/images.ts` `importFiles`

- The original `File` is stored untouched as `full`, profile and all. That's good: nothing
  is lost at import.
- `createImageBitmap(file, { imageOrientation: 'from-image' })` decodes the file to measure
  it (`pxW`, `pxH`) and to make the preview.
  - `colorSpaceConversion` is left at `'default'`, which the spec leaves implementation-defined
    ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)).
    In practice, browsers convert into the canvas's color space, which is sRGB.
- The preview (`makeThumb`) is a 1400 px JPEG at quality 0.85 from an sRGB canvas, so it's
  sRGB. The desk, sidebar, and Export preview all show it, which means the user never sees
  their P3 colors while editing. That's acceptable for layout work, but it matters for
  soft-proofing (section 5).
- HEIC is accepted by extension. Only Safari, and so the Mac app's WebKit, decodes it. In
  Chrome or Firefox, a HEIC import fails at `createImageBitmap` and lands in `failed`.

### Reading metadata: `src/imageInfo.ts` `readImageInfo`

It reads the format, ppi, and EXIF orientation. It doesn't read the ICC profile (JPEG APP2
`ICC_PROFILE`, PNG `iCCP`/`cICP`/`sRGB`), so nothing downstream knows a photo's color space.

### PDF: `src/pdf.ts` `renderPdf` and `embed`, `src/pdfImage.ts` `passThrough`

Each draw takes one of two paths:

1. **Pass-through** (a JPEG at most 1.5× the pixels needed across, per `PASS_THROUGH_SLACK`).
   - The original bytes go in through `pdf.embedJpg`.
   - pdf-lib's `JpegEmbedder` sets `ColorSpace` from the channel count alone: 3 becomes
     `/DeviceRGB`, 1 becomes `/DeviceGray`, and 4 becomes `/DeviceCMYK` (checked in
     `node_modules/pdf-lib/cjs/core/embedders/JpegEmbedder.js`).
   - The JPEG's embedded profile is still in the bytes, but PDF readers ignore profiles
     inside DCT streams; the image dictionary's `ColorSpace` governs
     ([DynaPDF manual](https://www.monkeybreadsoftware.de/dynapdf/dynapdf_541.shtml),
     [ICC white paper 36](https://color.org/whitepapers/ICC_White_Paper36-Embedding_and_referencing_profiles.pdf)).
   - So a Display P3 or Adobe RGB JPEG is read as "device RGB". Viewers treat that roughly
     as sRGB; a RIP uses whatever its default RGB profile is.
2. **Re-encode** (everything else: larger JPEGs, PNG, HEIC, WebP, AVIF).
   - `decodePhoto` (`src/rasterExport.ts`) decodes with `createImageBitmap`, which converts
     to sRGB and clips anything outside sRGB's gamut.
   - The visible part is drawn to an sRGB `OffscreenCanvas`, then `convertToBlob('image/jpeg', 0.92)`.
   - WebKit tags its canvas output only for a Display P3 canvas
     ([WebKit](https://webkit.org/blog/12058/wide-gamut-2d-graphics-using-html-canvas/)).
     From an sRGB canvas the JPEG is untagged sRGB, and it's embedded as `/DeviceRGB`.
   - It's 8 bits a channel: a 16-bit PNG or TIFF-sourced image loses its precision, and
     transparency is flattened onto white.

The document itself:

- pdf-lib writes a PDF 1.7 header with object streams.
- There's no `OutputIntents`, no XMP metadata, no trailer `/ID`, and no `TrimBox` or
  `BleedBox`: each page's MediaBox is the trim size.
- There's no text, so there are no fonts to embed. That makes PDF/X much easier.

### Images: `src/rasterExport.ts` `renderImages`

The whole page is drawn on an sRGB canvas (capped at 16 MP by `MAX_CANVAS_PIXELS`) and saved
as JPEG 0.92 or PNG. The files are untagged sRGB. That's fine for screens and for labs that
assume sRGB, but wide gamut is lost.

### InDesign: `src/indesign.ts` `linkable`

This is the best color path today:

- PNGs and upright JPEGs are linked **as they are**, profile intact, and InDesign
  color-manages them properly.
- JPEGs with an EXIF orientation, and other formats, are re-encoded on an sRGB canvas at 0.95.
  They're converted to sRGB and untagged.

### Concrete risks

| Risk                                             | Where                                        | Effect                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wide-gamut JPEGs pass through as `DeviceRGB`** | `pdf.ts` `embed`, `embedJpg`                 | iPhone photos saved as JPEG ("Most Compatible") are Display P3, and many camera JPEGs are Adobe RGB. Read as sRGB, they print desaturated and shifted: Adobe RGB greens and cyans go dull, and P3 reds and oranges flatten.                                                      |
| **The same photo prints two ways**               | `passThrough` threshold                      | A photo placed large passes through untagged (dull); placed small, it's re-encoded and converted to sRGB (correct). Two copies of one photo in a book won't match.                                                                                                               |
| **CMYK JPEGs**                                   | `JpegEmbedder` `Decode` hedge                | pdf-lib inverts CMYK on purpose "as a hedge". Photoshop CMYK JPEGs can come out as negatives, and their CMYK profile is dropped either way. Unverified; needs a fixture. (`layout-model-plan.md` already notes some CMYK JPEGs won't embed.)                                     |
| **Wide gamut clipped on re-encode**              | `decodePhoto`, sRGB canvas                   | Saturated P3 colors (flowers, neon, sunsets) are clipped to sRGB before the printer sees them, even though modern presses can print some of those colors.                                                                                                                        |
| **HEIC prints from the preview, silently**       | `indesign.ts` `linkable`                     | A HEIC imported in Safari or the Mac app, then exported from Chrome or Firefox, can't be decoded there, so the 1400 px JPEG preview is linked instead, with no notice. (The PDF path counts these as `previews` and warns.)                                                      |
| **Full-bleed photos lose their overhang**        | `renderPlan.ts` `planPage` crops to the page | A photo meant to run off the edge is cut exactly at the trim. The printer then has to add bleed (stretching, mirroring, or leaving a white sliver). Lulu warns this "can be pages with a thin white border" ([Lulu blog](https://blog.lulu.com/how-to-make-a-print-ready-pdf/)). |
| **No trim or bleed boxes, no output intent**     | `pdf.ts`                                     | Preflight at a printer flags the file. It isn't PDF/X, and the RIP's defaults decide the color.                                                                                                                                                                                  |
| **Generation loss**                              | JPEG 0.92 re-encode                          | Small, but visible in smooth gradients (skies) after the camera's own JPEG compression. Print could use 0.95+ or Flate.                                                                                                                                                          |

## 3. What a print-ready file needs

A checklist. Items marked ✓ are already true today.

**Geometry**

- [ ] **Trim size** exactly the product size, per page. ✓ (the MediaBox is the trim today)
- [ ] **Bleed**: content extends past the trim, usually by 0.125 in or 3 mm on each outside
      edge. Some services want more:
  - Lulu: 0.125 in, and the page is the trim plus bleed ([Lulu](https://help.api.lulu.com/en/support/solutions/articles/64000254609-pdf-creation-settings)).
  - Blurb: 0.125 in top, bottom, and outside ([Blurb](https://blurb.co.uk/pdf-to-book)).
  - Mixam: 3 mm, or 20 mm for hardcover covers ([Mixam](https://mixam.co.uk/support/checklist)).
  - Gelato: 4 mm ([Gelato](https://support.gelato.com/en/articles/8996349)).
  - Lulu wants bleed on all four sides of every single page; Blurb's spreads-style books want
    none at the gutter.
- [ ] **TrimBox and BleedBox** on every page (required by PDF/X), with MediaBox = BleedBox.
- [ ] **Safe area**: nothing important within 0.25–0.5 in of the trim, plus a gutter
      allowance on the binding side (Lulu: 0.5 in safety and 0.2 in gutter; Mixam: 5 mm).
- [ ] **No crop marks** for print-on-demand services (Lulu says don't include them). Offset
      printers may want them, offset outside the bleed.
- [ ] **Single pages, not spreads**, for nearly all services (Lulu, Gelato, Peecho). Spreads
      are for the screen.

**Pages**

- [ ] **First page on the right, last on the left.** ✓ (Sequence's first and last spreads
      are single pages, which matches Blurb's rule exactly ([Blurb](https://blurb.co.uk/pdf-to-book))
      and Lulu's "page 1 is on the right".)
- [ ] **Page count rules**:
  - Even is always true in Sequence, since there's 1 + 2n + 1 pages.
  - Saddle-stitched zines need a multiple of 4.
  - Some products need a multiple of 6, which a summary of Blurb's checklist reports for its
    13 × 20 and 15 × 23 books; confirm on Blurb's site.
  - Products have minimums and maximums: Peecho's A4 photobook needs at least 24 pages; Blurb's
    range is reported as 20–440.
- [ ] **Cover**: a separate file, usually one wide page (back, spine, front) whose spine
      width depends on page count and paper. Peecho has a spine-width endpoint
      ([Peecho](https://www.peecho.com/print-api)). Sequence doesn't model a cover at all.

**Images**

- [ ] **Resolution**: 300 ppi at print size is the norm. Lulu also caps covers at 600.
      ✓ (warnings via `resolution.ts`, and the PDF embeds at real resolution)
- [ ] **Every image tagged** with its ICC profile (`ICCBased`), or converted to the output
      intent's CMYK.
- [ ] **No transparency** for X-1a/X-3. ✓ (none today: PNG alpha is flattened)
- [ ] **No RGB at all** if the printer demands PDF/X-1a.

**Color**

- [ ] **An output intent**: an ICC profile naming the press condition.
  - Common ones: GRACoL 2013 (CRPC6, US coated), FOGRA51/PSO Coated v3 (European coated),
    FOGRA52 (uncoated), SWOP (US web).
  - The ICC registry lists the reference names
    ([FOGRA51](https://registry.color.org/cmyk-registry/fogra51),
    [CRPC6](https://registry.color.org/cmyk-registry/cgats21-2-crpc6),
    [GRACoL2013 profile](https://registry.color.org/profile-registry/GRACoL2013_CRPC6), which
    lists a 320% total ink limit).
- [ ] **A rendering intent** for photos:
  - Perceptual compresses the whole gamut smoothly.
  - Relative colorimetric with black point compensation keeps in-gamut colors exact and
    clips the rest.
  - Photos usually suit perceptual; PDF lets us say so per image (`/Intent`).
- [ ] **Black and ink**:
  - Text and solid black should be 100% K, which Blurb asks for ([Blurb](https://blurb.co.uk/pdf-to-book)).
  - A rich black under the total ink limit (Lulu caps it at 270%).
  - Sequence has no text or solid fills yet, so this applies once it does (folios, captions,
    colored backgrounds). A black page background from an sRGB `#000` converts to a heavy
    four-color black; that's fine for photos but should be checked against the ink limit.
- [ ] **Grayscale photos as Gray**, for even neutrals on color presses (Lulu asks for gamma
      2.2–2.4). A black-and-white photo in RGB can print with a color cast.
- [ ] **Paper**: uncoated stock spreads ink more (dot gain, or tone value increase), so
      photos print darker and duller. That's why there are separate coated and uncoated
      conditions. The output intent has to match the paper, which is a product choice, not a
      file choice.

**File**

- [ ] **PDF/X**, the ISO 15930 family:
  - All parts need an output intent (`GTS_PDFX`), TrimBox or ArtBox, no encryption, `Trapped`
    set, and a trailer `/ID` ([PDF Association](https://pdfa.org/technical-side-and-requirements-of-pdfx)).
  - **X-1a**: CMYK, gray, and spot only; no RGB, no transparency.
  - **X-3**: adds ICC-based RGB and Lab, but no transparency.
  - **X-4**: adds live transparency, layers, and full ICC color management, and requires XMP
    metadata. It's the modern default (Gelato and Cloudprinter ask for it; Blurb's own preset
    is X-3).
- [ ] **No security** and no password (Lulu).
- [ ] **Size limits**: services cap uploads, and big books with full-size originals can be
      hundreds of MB. We should show the size before uploading.

## 4. Options

### (a) RGB, correctly tagged, printer converts: PDF/X-4 + output intent

**What it means**

- Every image goes in as `ICCBased` with its own profile:
  - A pass-through JPEG gets its APP2 profile, extracted and embedded once per distinct profile.
  - A re-encoded image gets sRGB, or Display P3 when it was rendered on a P3 canvas.
- Each page has TrimBox and BleedBox.
- The catalog has an `OutputIntents` entry with the chosen press profile, plus XMP, `/ID`,
  and `Trapped`.
- The RIP converts to its own CMYK, tuned for its press and paper, which is the conversion
  it's best at.

**Feasible on the web?** Yes, with pdf-lib's low-level API. pdf-lib has no first-class
support for any of this, but nothing is blocked:

- **ICCBased images.** `embedJpg` can't take a color space, so we'd write the image XObject
  ourselves: `pdf.context.stream(jpegBytes, { Type: 'XObject', Subtype: 'Image', Width, Height,
BitsPerComponent: 8, ColorSpace: [PDFName 'ICCBased', iccStreamRef], Filter: 'DCTDecode' })`,
  where the profile is `context.flateStream(iccBytes, { N: 3 })`. The JPEG header parsing
  pdf-lib does (SOF for size and channels) is ~30 lines, and `imageInfo.ts` already walks the
  markers, so it can also collect APP2 chunks.
- **Boxes.** `PDFPage.setTrimBox`/`setBleedBox`/`setMediaBox` exist.
- **Output intent, XMP, `/ID`, and `Trapped`.** `pdf.catalog.set(PDFName.of('OutputIntents'), …)`,
  a metadata stream, `context.trailerInfo.ID`, and `setTrapped` in the Info dictionary. The
  header version and object streams are controllable: `save({ useObjectStreams: false })`
  matters for X-1a/X-3, which predate PDF 1.5 object streams.
- **Profiles.** We'd ship sRGB (about 3 KB, freely distributable from color.org) and one or two
  press profiles. Press profiles are large (hundreds of KB to a few MB) and their licenses
  vary. ECI's FOGRA profiles are freely distributable; GRACoL's terms need checking. They can
  be lazy-loaded only when exporting for print.
- **Wide gamut on re-encode.** Use `new OffscreenCanvas(...).getContext('2d', { colorSpace: 'display-p3' })`
  when the source is wider than sRGB, and tag the output P3.
  - Safari has supported this since macOS 12.1 / iOS 15.1, and embeds a P3 profile in
    `toBlob`/`convertToBlob` output ([WebKit](https://webkit.org/blog/12058/wide-gamut-2d-graphics-using-html-canvas/)).
  - Chrome supports `colorSpace` on 2D canvas; Firefox doesn't.
  - Whether `createImageBitmap` keeps P3 when the destination canvas is P3 needs a test on
    each engine. Fallback: render in sRGB and tag sRGB, which is correct, just narrower.
- **Validation.** There's no free PDF/X validator like veraPDF (which covers PDF/A and UA).
  We'd check with Acrobat Pro Preflight or callas pdfToolbox once by hand, and keep a
  structural unit test (boxes, intent, `ICCBased` on every image).

**Trade-offs**

- **For**:
  - Accepted by Lulu, Gelato, Peecho, Mixam, Cloudprinter, and most labs.
  - Keeps wide gamut for presses that can use it (HP Indigo, which Blurb uses, and 6–7 color
    inkjet presses).
  - One file serves screen and print: a tagged PDF also looks right on screen.
  - Small dependency footprint.
- **Against**:
  - We don't control the RGB-to-CMYK conversion, so what you get depends on the printer's RIP.
  - Soft-proofing (section 5) is an approximation unless we use the printer's own profile.
  - Strict offset printers asking for X-1a won't take it.

### (b) Convert to CMYK ourselves (PDF/X-1a or X-4 with CMYK images)

**What it means**

- Each image is converted, with a chosen rendering intent and black point compensation, from
  its own profile to the press profile with Little CMS.
- The result is written as CMYK JPEG, or Flate.
- The output intent is that same profile.

**On the web**

Possible, but heavy:

- Color conversion: [lcms-wasm](https://npmjs.com/package/lcms-wasm) (Little CMS in WASM,
  works in workers) or [jsColorEngine](https://cdn.jsdelivr.net/npm/jscolorengine@1.4.4/README.md).
- The browser can't encode CMYK JPEG, so it would need a WASM encoder (mozjpeg can take CMYK)
  or Flate, which makes huge files.
- All of this is done on decoded 8-bit sRGB or P3 canvas pixels, and limited by canvas memory.

**In the Mac app**

Much better:

- ImageIO decodes HEIC, 16-bit, and every embedded profile natively.
- ColorSync/Core Graphics (`CGColorSpace`, `CGContext` in a CMYK color space) converts.
- `CGPDFContext` writes PDFs with an output intent: Apple documents `kCGPDFContextOutputIntent`
  and the `kCGPDFX…` keys ([Apple](https://developer.apple.com/documentation/coregraphics/kcgpdfcontextoutputintent)).
- Alternatively, Rust with the `lcms2` and `image` crates for a cross-platform path.

**Trade-offs**

- **For**:
  - Total control and a true soft proof.
  - Satisfies X-1a printers and local offset shops.
  - Matches what InDesign users do.
- **Against**:
  - It's easy to do worse than the printer: a wrong profile, or the wrong paper, is baked in
    and can't be undone.
  - Blurb, through forum reports, and Lulu say not to convert, or to send sRGB.
  - Bigger engineering surface, and really Mac-only.

### (c) Order through a print-on-demand API

**What it means**

- Sequence makes the interior PDF (option a, with the service's product preset) and a cover,
  uploads them, and creates an order with a product SKU, quantity, and shipping address.
- Candidate services:
  - **Lulu Print API.** Interior plus a one-piece cover PDF, fetched by URL. There's a sandbox
    that doesn't charge, and webhooks for status. Files are validated and normalized before
    production ([Lulu](https://help.api.lulu.com/en/support/solutions/articles/64000254607-what-files-are-required-for-lulu-print-api-production-)).
    Best documented, with photo-book-capable products.
  - **Peecho.** A print API for books and magazines; RGB at 300 dpi. It can put the cover in
    the same PDF and generate a blank or dynamic spine, which is simplest for us
    ([Peecho](https://www.peecho.com/print-api)).
  - **Gelato** and **Prodigi**. Global print-on-demand APIs with photo books, specified per SKU.
    Gelato wants PDF/X-4 with a 4 mm bleed.
  - **Blurb.** PDF to Book with its own X-3 preset, but no public self-serve ordering API that
    we found.
  - **Printful.** Photo books exist, but it's built around its Design Maker, not print-ready
    PDF uploads.

**Feasibility**

- It needs a server, since the services fetch files by URL and API keys must stay secret.
  `sequence-server` (already used for Instagram) is the natural home.
- It also needs payments (a merchant account, or a pass-through checkout), address entry,
  order status, support for misprints, and a cover designer. Both web and Mac can use it.

**Trade-offs**

- **For**:
  - The biggest user value ("I sequenced it, now hold it").
  - Specs come from the service's product data, so presets are exact.
  - Possibly a revenue share.
- **Against**:
  - The operational and support burden.
  - Each service's cover and spine rules.
  - Lock-in; and a privacy change, since photos leave the device, which the privacy policy
    must say.

### Web vs Mac at a glance

| Capability                                         | Web                                    | Mac app                            |
| -------------------------------------------------- | -------------------------------------- | ---------------------------------- |
| Tag images ICCBased, output intent, boxes, PDF/X-4 | Yes (pdf-lib low-level)                | Yes (same code, or Core Graphics)  |
| Keep P3 when re-encoding                           | Safari, Chrome (P3 canvas); Firefox no | Yes (WebKit P3 canvas, or ImageIO) |
| HEIC originals                                     | Safari only                            | Yes                                |
| 16-bit sources at 16-bit                           | No (canvas is 8-bit)                   | Yes (ImageIO/Core Graphics)        |
| Pages over ~16.7 MP (images export)                | Needs tiling (layout-model.md step 3)  | Native renderer, no limit          |
| Soft proof / gamut warning                         | lcms-wasm (lazy, ~hundreds of KB)      | ColorSync, free                    |
| CMYK conversion and X-1a                           | Possible but heavy                     | Practical                          |
| Order via API                                      | Via sequence-server                    | Via sequence-server                |

## 5. UX: a Print destination

**Where it goes.** Add a fifth destination, **Print**, to `DESTINATIONS` in
`ExportView.tsx`, beside PDF. PDF stays as the screen/proof PDF (spreads allowed, no bleed).
Print is always single pages, always tagged, and always bleeds. Keeping them separate avoids
a pile of options on PDF that only make sense for one purpose. (Alternative: PDF gains a
"For: Screen · Print" segmented control. It's simpler, but options would show and hide.)

**Options panel**, top to bottom:

1. **Printer**: a preset menu.
   - The choices: Generic (PDF/X-4, GRACoL), Lulu, Blurb, Mixam, Gelato, Peecho, and Custom.
   - A preset sets the bleed, gutter bleed (yes or no), PDF/X version, output intent, marks,
     and page-count rules, with a link to the service's spec page.
   - With a preset from an API (phase 5), the product picker comes from the service.
2. **Paper**: Coated / Uncoated. It picks the output intent (GRACoL or FOGRA51 vs FOGRA52 or
   an uncoated profile). Hidden when the preset decides it.
3. **Bleed**: a value in the project's unit (0.125 in / 3 mm), and whether the gutter bleeds.
   - If photos touch the trim but don't extend past it: "4 photos stop at the page edge. Extend
     them into the bleed, or they may print with a white edge." Then "Show me", like the
     low-resolution warning.
4. **Marks** (Custom only): crop marks, offset.
5. **Advanced** (collapsed): rendering intent (Perceptual / Relative), "Keep wide-gamut color"
   (default on), and, on the Mac, "Convert to CMYK (PDF/X-1a)".

**Preview.** `OutputPreview` shows each page with:

- The **bleed area** shaded outside the trim, with photos extending into it.
- A **trim line**, and a dashed **safe area**.
- A **Soft proof** toggle that draws the preview converted through the output intent. Paper
  white and ink limits make it look duller, which is the point. It shows gamut warnings as a
  hatch over out-of-gamut areas.
  - On the web this uses lcms-wasm on the 1400 px previews, which is fast enough at preview
    size. On the Mac, ColorSync.
  - The previews are sRGB-clipped today, so a P3-aware preview would be needed for the gamut
    hatch to be honest. Or compute gamut from the original at preview size.

**Warnings**, in the existing `export-actions` block, under the low-resolution one:

- Low resolution (exists), with the threshold from the preset (Blurb's guidance is looser
  than 300).
- Photos stopping at the trim (missing bleed).
- Important content in the safe area or gutter: a photo's center is closer than the safe
  margin. This is heuristic; maybe only for small photos.
- Page count: "Lulu's hardcover needs at least 24 pages; this book has 18." Or "a saddle-stitched
  zine needs a multiple of 4: add 2 pages." With an Add pages button.
- Photos that couldn't be read at full size (exists as a notice; promote it to a warning
  before export, and fix the silent InDesign case).
- Out-of-gamut share, from the soft proof: informational, not blocking.
- Estimated file size, versus the preset's limit.

**In the editor**, not just at export:

- Bleed should be part of the page, so people can drag photos past the trim on purpose. That
  means `PageSetup.bleed` (in the project's unit), shown as a faint band around pages, with
  the trim and bleed edges as snap targets. The Layout → Page tab is where it's set.
- The render plan then just widens `pageRegion` by the bleed (outside edges only, or the
  gutter too), and the boxes fall out of it.
- `planPage` already computes the off-page `placed` rectangle, so photos crossing the bleed
  need no new logic.

## 6. Phased plan

Smallest valuable step first; each is its own PR and leaves the app working.

1. **Consistent, tagged color in today's PDF.** A bug fix; no UI.
   - Teach `imageInfo.ts` to collect the ICC profile (JPEG APP2 chunks; PNG `iCCP`, or
     `sRGB`/`cICP` chunks).
   - Embed JPEGs ourselves as `ICCBased` XObjects, with one profile stream per distinct profile.
     Untagged JPEGs are treated as sRGB.
   - Tag re-encoded images sRGB.
   - Handle CMYK JPEGs deliberately: pass them through with their profile and the correct
     `Decode` per Adobe APP14, or convert them.
   - Fix `indesign.ts` falling back to the preview silently.
   - Tests:
     - Fixtures for P3, Adobe RGB, untagged, gray, and CMYK JPEGs.
     - Assert every image XObject in the output has an `ICCBased` color space.
     - Check by eye in Preview and Acrobat that the passed-through and re-encoded copies of a
       P3 photo now match.
2. **Keep wide gamut on re-encode.**
   - Use a Display P3 canvas where supported and the source is wider than sRGB, and tag the
     result P3. This applies to the PDF and InDesign re-encodes, and optionally to the images
     export.
   - Feature-detect via `getContextAttributes().colorSpace`; fall back to sRGB.
3. **Bleed and trim.**
   - `PageSetup.bleed` (schema v5), editor bands and snapping, and the render plan's region
     widened.
   - TrimBox and BleedBox in the PDF, and single-page output with per-side bleed.
   - Missing-bleed and page-count warnings.
   - The PDF stays a plain PDF, but it's already acceptable to Lulu and Mixam.
4. **Print destination with PDF/X-4.**
   - Output intent (lazy-loaded profiles), XMP, `/ID`, `Trapped`, and the version header.
   - Presets for Generic, Lulu, Blurb, Mixam, and Gelato.
   - The safe-area overlay in the preview.
   - Validate once with Acrobat Preflight or callas, and record the result in `docs/testing.md`.
5. **Soft proof and gamut warning.**
   - lcms-wasm in a worker, lazy-loaded on the web; ColorSync on the Mac via a Tauri command.
6. **Mac native renderer.** (Already planned as layout-model.md step 4.)
   - ImageIO and Core Graphics read originals with their profiles (HEIC and 16-bit included)
     and write PDFs and large images without canvas limits.
   - Optional CMYK conversion and PDF/X-1a for offset printers.
7. **Order prints.**
   - Lulu Print API (or Peecho) through `sequence-server`, with a product picker, cover
     generation (front, spine, and back from chosen photos, with spine width from the
     service), checkout, and order status.
   - Privacy policy update.

Steps 1–2 are worth doing even if a Print destination never ships: they make today's PDF and
InDesign exports correct.

## 7. Open questions for the product owner

1. **Who is the first print customer?**
   - A print-on-demand service (most users, RGB is fine), or a local offset or risograph
     printer (wants X-1a or CMYK, crop marks)?
   - This decides whether option (b) is ever needed.
2. **Is ordering prints in-app (option c) a goal?**
   - If so, which service first: Lulu, for documentation and a sandbox; or Peecho, for the
     simplest cover handling?
   - Are you willing to run payments, addresses, and support through `sequence-server`?
3. **Bleed in the document model.** Should bleed be part of a project's page setup, visible
   while editing (recommended), or only an export option that extends photos already touching
   the edge?
4. **Covers.** Should Sequence design covers (front, spine, and back, with spine width by page
   count)? Or should the first export be interior-only, with the cover made elsewhere?
5. **Text.** Are folios, captions, or a title page coming? They bring fonts (embedding, or
   outlines), 100% K text, and rich-black rules into scope.
6. **Wide gamut by default.** Should the PDF keep Display P3 when the original has it
   (more saturated on good presses, and a slightly larger file), or normalize everything to
   sRGB (more predictable)? Recommendation: keep it.
7. **Profile licensing and size.** Is it OK to lazy-load press profiles (hundreds of KB to a
   few MB) from our site? Which ones: GRACoL 2013 for the US, PSO Coated v3 / FOGRA51 for
   Europe, plus an uncoated one?
8. **Mac-only features.** Are CMYK conversion, true soft-proofing, 16-bit, and HEIC in
   Chrome acceptable as Mac-only, given the small number of users on both platforms?
9. **Zines.** Should a "Zine" preset enforce a multiple of 4 pages and offer saddle-stitch
   imposition (printer spreads) for people printing at home or at a riso shop? Or is that
   out of scope?
