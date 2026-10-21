# Exports

Export (a page of the window: ⌥⌘3 or ⇧⌘E) saves a PDF, images, or an InDesign
file, or posts to Instagram, with a preview of what it makes. Every export draws from the same
plan (`src/renderPlan.ts`), in output pixels, from the original photos.

## PDF

One PDF page per spread (a book's first and last pages are single) or per page, at true size. Guides are left out.

## Images

A ZIP of JPEGs or PNGs: one per frame, or for spreads one per spread or per page (`01.jpg`,
`02-03.jpg`, …, in order). Pixel pages come out at their pixel size; inches at the chosen dpi.

## InDesign

A ZIP with an `.idml` file and a `Links/` folder of the placed photos. Unzipped, the `.idml`
opens in InDesign (or Affinity Publisher) as a facing-pages document at the book's size (or
single pages, for frames), with the On drop border guide as margins, the other guides as ruler
guides, and each photo in a frame linked to its original. If InDesign reports missing links,
relink them to the `Links` folder.

## Instagram

A single image, a carousel, or a story, posted to the user's Instagram professional account
through Sequence's server (`server/`): the app uploads the frames, Instagram fetches them, and
the server deletes them. Connecting and disconnecting are in Settings; the privacy policy
(`site/privacy/index.html`) explains what's kept. [server/README.md](../../server/README.md)
has the details.
