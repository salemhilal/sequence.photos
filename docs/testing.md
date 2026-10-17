# Testing Sequence

What to check before a release: the automated checks, then a pass through the app by hand.
Tick items off as you go.

Tags: **[S]** spreads only, **[F]** frames only, **[S≠F]** behaves differently in each;
**[in]** and **[px]** for a page in inches or pixels. Untagged items apply to all. Test the
combinations where it matters: make a book, then switch it to frames, and to pixels, in Layout
(and back). Pixel spreads and frames in inches work too.

## Automated checks

- [ ] `npm test`: unit tests pass.
- [ ] `npx tsc -b` and `npm run lint`: no errors or warnings.
- [ ] `npm run format:check`: formatted.
- [ ] `npm run build`, then `node scripts/check-web-bundle.mjs`: the website has none of the
      Mac app's code. `dist/_headers` has the Content Security Policy for `/*`, naming both of
      Sequence's servers and a `sha256-` hash for the app page's inline script.
- [ ] `npm run build:web-ui-for-app`, then `node scripts/check-app-bundle.mjs`: the Mac app's
      build has none of the website's pages.
- [ ] `npm run test:app`: the Mac app end-to-end test passes (open, Save, Save As, relaunch,
      sandboxed).
- [ ] In `server/`: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`.

## Startup and projects

- [ ] Phone or touch-only browser: "Sequence is made for a computer" appears; Continue anyway
      shows the app; a reload shows the notice again.
- [ ] Fresh browser profile: the tour starts by itself once, not again after a reload.
- [ ] A second tab: one tab says "Sequence is open in another window"; Use it here moves
      editing there and blocks the other.
- [ ] Reload after editing: everything comes back (desk, spreads or frames, guides, layout,
      size).
- [ ] File → New project… with photos: Cancel / Save first / New project. New
      project empties everything; ⌘Z brings the old one back.
- [ ] A new project's empty desk: "Start by adding photos", Add photos, and a Page card with
      the same settings as Layout's Page tab (no Content), applied as they're picked (no Apply):
      picking Frames or a preset, then adding photos, keeps the choice. **[F]** It says to drag photos onto
      frames.

## Desk

- [ ] Add photos (⌘I or the button): progress in the status bar, then the photos at full size
      (sharp at 100% zoom), in rows of six below anything already on the desk, with the view
      zoomed to fit them. An unreadable file: "Couldn't read N files".
- [ ] Drop image files from the Finder: "Drop to add photos", then they're added.
- [ ] Drop a `.photo-sequence` file: "Drop to open project", then it opens after a confirm.
- [ ] Paste an image copied in another app (⌘V): added as "Pasted image HH.MM.png".
- [ ] Scroll or Space-drag pans; pinch or ⌘-scroll zooms around the cursor; the zoom buttons
      zoom around the center; the middle one (no percentage) zooms to show every photo.
- [ ] Click selects; Shift- or ⌘-click adds or removes; drag on empty desk to marquee-select;
      clicking empty desk clears.
- [ ] Dragging selected photos moves them together and brings them forward; one ⌘Z undoes it.
- [ ] Corner-handle resize keeps proportions; Shift resizes freely.
- [ ] Arrows nudge ⅛ in, Shift+arrows 1 in; a run of nudges is one undo step.
- [ ] ⌘A selects all, Delete removes, Escape clears the selection.
- [ ] ⌘D duplicates (offset, selected, "… copy.jpg"). ⌘C then ⌘V pastes copies that step
      further each time; copying in the app and pasting into another app gives the image.
- [ ] Tap Space with photos selected: Quick Look (holding Space doesn't). ←/→ browse with a
      counter; click shows actual pixels and drag looks around; Space or Escape closes.
- [ ] Right-click the desk: Tidy up (or "Tidy up N photos") makes a grid; the desk color
      swatches change it at once.
- [ ] Right-click a photo: Quick Look, Copy image, Duplicate, Return to desk (placed photos),
      Delete ("Deleted … Undo to bring it back").
- [ ] With every photo placed: "Every photo is placed". The toolbar shows no counts, only
      progress while importing or exporting.

## Sidebar (spreads and frames)

- [ ] **[S≠F]** Heading "Spreads" [S] or "Frames" [F]. Scrolling the list shows "N pages" [S] /
      "N frames" [F] ("1 frame" for one) at its foot, gone a second after scrolling stops.
- [ ] One column to start; the header's slider sets 1–4 columns (as many as fit), and it
      survives a reload.
- [ ] **[S≠F]** Labels: 01, 02–03, …, the last single page [S]; 01, 02, 03… [F].
- [ ] **[S]** The first and last spreads have a locked grip ("The first and last pages stay in
      place") and no delete button.
- [ ] **[F]** A sequence's only frame can't be deleted or dragged; with more, any can.
- [ ] **[S≠F]** The header's +: a spread before the back page [S]; a frame at the end [F].
- [ ] Hover a gap and click "+ Add spread" / "+ Add frame": a new empty one appears there.
      **[F]** There are gaps before the first frame and after the last.
- [ ] Click a row: selected (outlined). ⌘-click (Ctrl elsewhere) adds or removes one;
      Shift-click selects a range. Clicking between rows, Escape, or selecting desk photos lets
      the selection go (and selecting rows lets the desk's go).
- [ ] Double-click a row, or hover it and click its pencil: the editor opens on it.
- [ ] Drag a row: it moves with the rest of the selection, in order, to the lit gap (dragging
      an unselected row moves it alone). **[S]** Not before the first or after the last spread;
      those two don't move. **[F]** To the very start or end works. One ⌘Z undoes it.
- [ ] Delete (or Backspace) deletes the selected rows in one undo step, photos back to the
      desk. **[S]** The first and last spreads stay. **[F]** At least one frame stays.
- [ ] A row's ×: deleted, its photos go back to the desk; if it was open, the editor closes.
- [ ] Drag desk photos onto a thumbnail: **[S]** onto the left or right page (highlighted);
      **[F]** onto the frame. They fit the On drop guide, centered.
- [ ] Drag desk photos onto a gap ("Drop to add a spread/frame"): a new one holding them.
- [ ] Drag a photo from one thumbnail to another spread or frame: it moves; onto the desk: it
      lands where dropped.
- [ ] Drag a photo a little and drop it back on its own page or frame: it stays exactly as it
      was.
- [ ] Widen the sidebar from its edge: thumbnails grow, columns drop when they no longer fit;
      double-click resets; the width survives a reload.
- [ ] ⌘B hides and shows it, and that survives a reload.

## Spread and frame editor

- [ ] The header shows the folio (frame 3 is "03") and the size in in **[in]** or px **[px]**.
- [ ] ‹ › (and ←/→ with nothing selected) go back and forth, disabled at the ends.
- [ ] Click a strip photo: **[S]** placed on the first empty page, else the right; **[F]**
      placed on the frame.
- [ ] Drag a strip photo onto the page or frame: placed. Drag a placed photo onto the strip:
      back to the desk. The strip says "Desk · N", or "Empty…".
- [ ] Moving snaps to edges, center lines, border guides, and ruler guides, with feedback; Alt
      turns snapping off. **[S]** Photos snap to the gutter and can cross it.
- [ ] Corner resize keeps proportions and snaps; Shift resizes freely; Alt doesn't snap.
      **[px]** Resizing stops at 10 px.
- [ ] Arrows nudge 1/16 in (Shift ½ in) **[in]** or 1 px (Shift 10 px) **[px]**.
- [ ] Delete returns the selected photo to the desk; Escape deselects, then closes; clicking
      the backdrop closes.
- [ ] Hide guides (eye button or ⌘;): guides disappear; photos still snap to edges.
- [ ] **[S≠F]** Inspector: "Left page"/"Right page" [S] or "Frame" [F]; X/Y/W/H in inches
      **[in]** or whole px **[px]**, X from that page's left edge.
- [ ] Keep proportions on: changing W changes H and back; off: independent.
- [ ] After clicking Keep proportions (or any checkbox), Escape, Delete, and the arrows still
      work.
- [ ] Quality: "N ppi" **[in]**, and "N ppi · below 300 dpi · may look soft" in orange when
      the photo has fewer pixels than the page's dpi asks for (lowering the dpi in Layout clears
      it); "Enlarged N% · may look soft" only when enlarged **[px]**. A photo stretched with
      Shift counts its thinner side.
- [ ] A photo below the page's resolution has a warning mark on it in the editor, and its
      spread's row in the sidebar has one, titled "N photos below 300 dpi" (or "enlarged").
- [ ] Center on page/frame and Fit page/frame work. "Fit … guide" buttons, largest first;
      hovering one makes its box glow; per-edge guides show a range and a tooltip.
- [ ] Right-click a placed photo → Duplicate: the copy is offset by a fortieth of the page's
      width (0.25 in on a 10 in page, about 27 px on a 1,080 px frame).
- [ ] Add a frame, open it, ⌘Z: the editor closes cleanly and desk shortcuts work.

## Layout

- [ ] Opens from the toolbar's Layout button (Mac: View → Layout…). Escape, ×, or the
      backdrop close it, including right after clicking a toggle or a checkbox.
- [ ] Two tabs (underlined, like Settings'), Page and Guides; the tab is kept while the app is
      open.

### Page tab

- [ ] Nothing changes until Apply: Pages, size, unit, preset, dpi, and Content are a draft.
      The stage always shows the real spreads or frames, with ‹ › and ←/→ through them: as
      they are, or as they'd be after Apply once something changes, without the view
      switching. Revert drops the draft. The draft survives switching to Guides and back.
      Closing Layout (Escape, ×, or outside it) with changes waiting asks: Cancel, Discard, or
      Apply.
- [ ] With changes waiting, the Guides tab asks first, as closing does: Cancel stays on Page,
      Discard drops them, Apply applies them, then Guides opens.
- [ ] The pager says only "1 / 6". Apply and Revert stay at the panel's foot while the settings
      above scroll (a short window).
- [ ] The swap button between W and H swaps them (in the draft).
- [ ] **[S→F]** Frames, Apply: each page becomes a frame in book order (a photo across the
      gutter goes with the page holding its center), same size and unit. One ⌘Z undoes it.
- [ ] **[F→S]** Switching straight back restores the book exactly. After editing: frame 1 is
      the first page, the rest pair into spreads, a leftover becomes the last page.
- [ ] **[in→px]** Picking px fills the size converted at the dpi (10 × 8 in at 300 → 3000 ×
      2400); Apply as is converts, and photos keep their resolution. Resolution shows 1×.
- [ ] **[px→in]** Picking in shows "Print at 300 dpi" and the size in inches (1080 px → 3.6 in);
      changing the dpi changes the size, until the size is edited.
- [ ] Content is enabled only when the size changes beyond converting. Rescale with layout:
      photos move and scale with the guides (book → Instagram 4:5 gives 54 px margins).
      Keep fixed: photos keep their converted size and place, relative to (a choice under it)
      each page's Center or Top left, or **[S]** Inside edge (the default for spreads; Top left
      for frames).
- [ ] Presets (Book, Zine, Square book, Slides, the Instagram sizes) set Pages, unit, and size
      at once; a custom size shows "Custom". Apply is one undo step.
- [ ] **[in]** Changing only the dpi moves nothing.
- [ ] The preview marks photos below the resolution: "N photos are below 300 dpi." as they
      are, "would be" with changes waiting (8 × 10 in → 16 × 20 in shows which go soft).
- [ ] Size: Apply resizes in one undo step; Enter applies. 10 → 8 → 10 puts photos and guides
      back exactly. Smallest size 1 in **[in]** or 100 px **[px]**.

### Guides tab

- [ ] Center lines: Vertical and Horizontal show or hide the magenta lines here and in the
      editor.
- [ ] Border guides: + adds one further in; linked, only Top can be edited and it sets all
      four; unlinking allows per-edge values; relinking takes the top's. **[S≠F]** Edges are Inside/Outside, mirrored
      on facing pages [S], or Left/Right [F].
- [ ] On drop picks the guide dropped photos fit; removing it falls back to the largest; ×
      removes a guide; values can't push the box off the page.
- [ ] Ruler guides: drag from a ruler with a "N from …" label; Shift snaps to ⅛ in **[in]** or
      10 px **[px]**; dragging off removes; clicking selects and opens its section; Delete
      removes the selected guide. **[S≠F]** Rulers mirror from each outside edge [S] or run from
      the left [F]. Long px labels turn to fit.
- [ ] The Guides section's buttons add a guide at a third; its field moves it (whole px **[px]**).
- [ ] Sections fold by their titles; folding survives a reload.
- [ ] No hint in the title bar. The note at the panel's foot starts "Guides apply to every
      spread/frame" and ends "Drag a guide off the page/frame to remove it.

## Preview

- [ ] ⌘P or the toolbar: opens on the spread being edited, else the first. **[S≠F]** The
      button says "Preview book" [S] or "Preview" [F].
- [ ] →, Space, PageDown forward; ←, PageUp back; Home and End; arrow buttons disable at the
      ends. **[S]** Single pages on their side, with gutter shading.
- [ ] Folio and "n / total" are right.
- [ ] Controls fade after the pointer rests about a second; moving or Tab brings them back;
      they stay while hovered and while saving.
- [ ] The header's Export… opens the Export view.
- [ ] Escape, Exit preview, or ⌘P closes.

## Exports and project files

- [ ] File → Export… (⌘⇧E) opens the Export view: a preview of what it makes on the left,
      with ‹ › and ←/→, and the destination and its options on the right. Destinations: PDF,
      Images, InDesign, and Instagram. It opens on PDF for inches, Instagram for
      1080 px frames, else Images; then on the last one picked, with the last choices
      (spread or page, format, Print at), while the app is open.
- [ ] A conversion note (not a warning) shows only where the units differ: **[in]** Images:
      "Pages are measured in inches, so they're turned into pixels: 3000 × 2400 px a page" with
      At ___ dpi (up to the page's); Instagram: slides are made at Instagram's size. **[px]**
      PDF: "Frames are measured in pixels, so they're given a printed size: 3.6 × 4.5 in" with
      Print at ___ dpi (300). None for **[in]** PDF or InDesign, or **[px]** Images.
- [ ] **[S]** One PDF page per / One image per: Spread or Page. **[F]** Not shown: each frame
      is its own page or image.
- [ ] Photos below the export's resolution: "N photos are below 300 dpi." (or "are
      enlarged") above the button, with Show me opening the first in the editor, selected.
      Lowering the dpi updates it.
- [ ] Instagram shows Instagram's glyph. **[F]** Images has no "One image per" choice.
- [ ] Images: JPEG has a Quality slider (50–100%, 92% to start); PNG says it's lossless. Under
      it, "N images, ~X MB total", updating a moment after a change.
- [ ] The button names the result (Export PDF, Export N images, Export for InDesign) and shows
      the progress while exporting; once saved, the view closes. Cancelling the save keeps it.
- [ ] PDF: at true size, single first and last pages **[S]**, photos cropped at the edges, no
      guides; `photo-book-DATE.pdf` **[S]** or `sequence-DATE.pdf` **[F]**. **[px]** Pages are
      printed at the Print at dpi. **[in]** Photo resolution: Up to 300 (the page's); 150 makes
      a smaller file with the same page size.
- [ ] PDF at full resolution: a book of full-size phone photos at 300 dpi shows each photo
      at its own ppi, or 300 when it has more (Preview.app's inspector, or
      `pdfimages -list`). Photos taken on their side (EXIF orientation) come out upright,
      mirrored ones too. A PNG and a HEIC (Safari or the Mac app) embed. An unreadable original:
      "Some photos couldn't be read at full size…".
- [ ] InDesign: a ZIP with an `.idml` and `Links/`; opens in InDesign with facing pages **[S]**
      or single pages without facing pages **[F]** (photos where they sit on each), margins from
      the On drop guide, ruler guides, linked photos. **[px]** The document
      is in pixels at the same size (the panel says so).
- [ ] Images: a ZIP of JPEGs or PNGs, on white. **[F]** 01.jpg, 02.jpg… at the frame's size.
      **[S]** Per spread: 01.jpg, 02-03.jpg, … the last page; per page: 01.jpg… in book order.
      **[in]** At the chosen dpi (3000 × 2400 for 10 × 8 in at 300).
- [ ] A page too large for one image (11 × 17 in at 300 dpi): it's exported at the most that
      fits, and a notice says the dpi.
- [ ] Save project (⌘S) and open it into a fresh project (⌘O): "Opened … · N photos. Undo
      to go back."; ⌘Z restores. Frames come back as frames, and pixels as pixels.
- [ ] A project from an older version opens as a book with its guides.
- [ ] A damaged file: "The project file is damaged." A ZIP that isn't a project: "This file
      isn't a Sequence project." Either way the current project is untouched.
- [ ] A project from a newer version: the "saved by a newer version" screen with Reload.

## Settings

- [ ] Tooltips show after a second's hover; moving straight to another shows its tip at once.
- [ ] ⌘, opens on General; Advanced shows Server and Test images; tabs switch.
- [ ] Advanced → Test images: a count (1–50, 6 to start) and Add test images. It closes
      Settings, says "Making test images…", then imports like Add photos: "Gradient 01.jpg"…
      on the desk, in film colors that blend cleanly (no gray middles), about 3000 × 2000 px
      (portrait, landscape, or square). One undo removes them.
- [ ] Appearance: System, Light, Dark apply at once and survive a reload.
- [ ] Desk color: the swatches match the desk's menu and survive a reload.
- [ ] Storage (web): usage and Protected or not; Protect storage asks the browser.
- [ ] Server: Sequence, Development, or Local (an `http://localhost` address; Save only when
      valid and changed). Survives a reload. Running locally (`npm run dev`), the default is
      Development. The help says it applies the next time you connect Instagram.

## Instagram

Posts made while testing are real and public. Use a test account, or delete them after.

### Connecting

- [ ] Settings → Connect Instagram: "Opening Instagram…", then Instagram's sign-in (no
      Facebook option; it asks for basic access and publishing only).
- [ ] Finish signing in: back in the app, the address bar has no `#instagram=…`, a notice says
      "Connected to Instagram as @user", and Settings shows it.
- [ ] Cancel at Instagram: back with nothing said. A personal account, or a missing
      permission: the matching message in place of Settings' description.
- [ ] **Mac app** (a bundled build: `npm run build:app`; links don't reach `tauri dev`):
      Connect Instagram opens the sign-in in the default browser, and the button says to
      finish there. After signing in, the browser offers to open Sequence
      (`sequence-photos://instagram`); the app says "Connected to Instagram as @user". From
      Export, it reopens Export on Instagram. A sign-in finished after the app was quit is
      ignored ("started in another tab or window").
- [ ] Running locally with the Sequence server chosen: "Couldn't connect to the Sequence
      server. Check the server in the Advanced tab."
- [ ] A sign-in finished in a different tab (or opened twice): ignored, with a notice to
      connect from here.
- [ ] Back from Instagram's page without signing in: the Connect button is ready again.
- [ ] Disconnect: forgotten, with how to remove access in Instagram's settings.
- [ ] An expired connection, or one Instagram or the server refused: "Reconnect Instagram",
      with the reason.
- [ ] Two tabs: disconnecting or connecting in one shows in the other.

### Posting

- [ ] Export → Instagram, for any project. Before connecting, the preview, slides, and options
      all work; Account says posting needs a Business or Creator account, with Connect
      Instagram (or Reconnect), and Post is disabled. Coming back from Instagram's sign-in
      (connected or cancelled) reopens Export on Instagram.
- [ ] The panel: Account @user; Feed post or Stories; "A carousel of N slides" / "N
      stories, one per slide".
- [ ] Slides: every page or frame as a thumbnail with a checkbox; the first 10 with photos are
      chosen; an 11th can't be, and it says Instagram takes up to 10; "N of 10 chosen". Order
      follows the document. None chosen: "Choose at least one slide to post."
- [ ] **[S]** Spreads are torn into pages, with "Spreads are posted as their pages: N slides.
      Photos across the gutter continue onto the next slide."; a photo across the gutter
      continues from one slide to the next on Instagram.
- [ ] **[in]** A book in inches posts at Instagram's sizes (rendered at its dpi, then scaled).
- [ ] Preview: arrows and ←/→; feed shows dots and "n/N", a white card, and the caption with
      blue hashtags and mentions; stories show progress bars on a 9:16 screen.
- [ ] Pages outside 4:5 to 1.91:1 (feed), or too tall for stories: Size offers Crop or Expand
      to the nearest shape; the preview and help follow.
- [ ] Caption: "n / 2,200" and "n / 30 hashtags"; over either turns red and disables Post.
      Stories say they have no captions.
- [ ] Post: Preparing and Uploading slide n of N, Instagram processing, Publishing. Cancel
      until publishing: "Cancelled. Nothing was posted." and nothing appears on Instagram.
- [ ] While posting, Escape, ×, the backdrop, ⌘P, ⌘, and New project don't close or replace
      the pane.
- [ ] Done: "Posted to Instagram.", View on Instagram opens the post, Done closes. A failure
      shows its message and Post can be tried again.
- [ ] On Instagram: a carousel's slides are in order and cropped or expanded as chosen;
      stories in order.

## Undo and redo

- [ ] Toolbar buttons and ⌘Z / ⌘⇧Z (Ctrl+Y on Windows); disabled when there's nothing to do.
- [ ] One step each: a drag, a resize, a run of nudges, a run of typing in a field, adding,
      deleting, or moving a spread or frame, adding, moving, or removing a guide, Apply, a
      layout switch, an import or new project.
- [ ] Clicking a photo just to bring it forward isn't a step.
- [ ] In a text field, undo undoes the typing; after clicking a checkbox or toggle, it undoes
      the project.
- [ ] Undo and redo with the editor, Layout, or Preview open update them live.

## Shortcuts and hints

- [ ] Hold ⌘ (Ctrl) for a moment: badges on Undo, Redo, Preview, the sidebar toggle,
      Settings; releasing hides them.
- [ ] ⌘I add, ⌘O open, ⌘S export/save, ⌘⇧E export, ⌘P preview, ⌘; guides, ⌘,
      settings, ⌘B sidebar.
- [ ] Desk shortcuts (⌘A, ⌘C, ⌘D, Delete, arrows, Escape) do nothing while a dialog or the
      editor is open.

## Tour

- [ ] File → Take the tour (Mac: Help): a sample book replaces the project while it runs.
- [ ] Each step highlights its part: desk, sidebar, editor, Layout, Settings, Preview, and the
      File menu (web) or Save (Mac).
- [ ] Ending or skipping at any step restores your project and its undo history exactly;
      nothing from the tour is saved.

## Offline and updates (web)

- [ ] First load: "Ready to work offline." Reload offline: the app and project load.
- [ ] After a new deploy: "A new version is available."; Reload switches.

## Security headers (web, deployed)

- [ ] `curl -sI https://sequence.photos/app/` (and `/`, `/privacy/`, `/support/`) has the
      Content Security Policy, `X-Content-Type-Options: nosniff`, and a Referrer-Policy.
- [ ] In the app, the browser console shows no Content Security Policy violations while using
      it (including posting to Instagram).

## Sequence's server (deployed)

For each of `https://sequence-server.sequence-photos.workers.dev` and the `-dev` one:

- [ ] `GET /` is 404; `GET /meta/deletion` is 200.
- [ ] `GET /auth/callback` with no `state`, or an unknown client: 400, no redirect.
- [ ] A cancelled sign-in (`?error=access_denied&state=web.<43>.<43>`): 303 back to the app
      with `#instagram_error=cancelled`.
- [ ] A preflight to `/uploads` from `https://sequence.photos` is allowed; from elsewhere,
      refused (403).
- [ ] `POST /uploads` without a token: 401. A frame URL that doesn't exist: 404.
- [ ] With a real connection, a second `PUT` to the same frame URL: 409, the first image
      unchanged.
- [ ] `npx wrangler tail <worker> --format json` while signing in and posting: each step's
      route and outcome, and no tokens, codes, ids, or usernames.

## Mac app

- [ ] No web File menu or Undo/Redo buttons; the toolbar is the title bar (file name, "—
      Edited", drag to move the window).
- [ ] Menus in title case with shortcuts. File: New Project, Open…, Save, Save As… (⌘⇧S),
      Close; Add Photos…; Export… (⌘⇧E). The web File menu matches: New project…, Open
      project…, Save project; Add photos…; Export…; the tour and About.
- [ ] View: Preview, Layout…, Hide/Show Guides, Hide/Show Spreads [S] or Frames [F], following
      their state.
- [ ] Edit: Cut, Copy, Paste in text fields; Copy with photos selected copies them; Undo
      follows the project (and text fields while typing).
- [ ] Save writes the file and clears "Edited"; Save As… asks where; Open… and double-clicking
      a `.photo-sequence` open it; after a relaunch, Save still writes the same file.
- [ ] Quitting or closing with unsaved changes asks to save; unsaved changes survive a quit
      and relaunch.
- [ ] Exporting a PDF, images, or InDesign suggests the document's name ("Trip.pdf",
      "Trip (images).zip", "Trip (InDesign).zip"); an untitled project gets a dated name.
- [ ] Settings has General (Instagram, Appearance, Desk; no Storage) and Advanced (Server,
      Test images), as on the website.
- [ ] Opening a project from a newer version says to update from the App Store (no Reload).
