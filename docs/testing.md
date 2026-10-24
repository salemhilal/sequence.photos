# Testing Sequence

What to check before a release: the automated checks, then a pass through the app by hand.
Tick items off as you go.

Tags: **[S]** spreads only, **[F]** frames only, **[S≠F]** behaves differently in each;
**[in]** and **[px]** for a page in inches or pixels. Untagged items apply to all. Test the
combinations where it matters: make a book, then switch it to frames, and to pixels, in Layout
(and back). Pixel spreads and frames in inches work too.

## Automated checks

- [ ] `npm run check`: no secrets in committed env files, formatted, no lint or type errors,
      unit tests pass.
- [ ] `npm run build`, then `node scripts/check-web-bundle.mjs`: the website has none of the
      Mac app's code. `dist/_headers` has the Content Security Policy for `/*`, naming both of
      Sequence's servers and a `sha256-` hash for the app page's inline script.
- [ ] `npm run app:ui:build`, then `node scripts/check-app-bundle.mjs`: the Mac app's
      build has none of the website's pages.
- [ ] `npm run test:e2e`: the web app's interaction tests pass in Chromium and WebKit (the
      Mac app's engine): pages and their shortcuts, Esc staying on a page, Layout's
      unapplied-changes prompt, Preview's fullscreen option, the status bar (counts, selection,
      hints, page text, zoom), Settings (tabs, persisted toggles), shortcut badges, the spread
      editor (pager, zoom and pan, strip, Go to next error, Return to desk), scrubbing number
      fields, test images, and the private-window notice. CI runs them on every pull request.
      Items below marked _(e2e)_ are among them; check the rest by hand.
- [ ] `npm run test:app`: the Mac app end-to-end test passes (open, Save, Save As, relaunch,
      sandboxed, Preview's fullscreen, the Settings window and its sync with the main window).
      CI runs it on pull requests that touch the Mac side, and before App Store uploads.
- [ ] `npm run server:check`: the server's format, types, lint, and tests.

## Desktop feel

- [ ] The arrow cursor everywhere, including buttons, tabs, swatches, and sidebar cells; the
      hand only on links that open a web page (About's links, "Layout" in the empty desk).
      Text fields show the text cursor.
- [ ] Double-clicking or dragging across labels, headings, or the toolbar selects nothing;
      text fields, the caption, and About's version can still be selected.
- [ ] Photos and thumbnails don't drag out as image files.
- [ ] Filled buttons (Layout, Preview, Export, Apply) don't change on hover and darken while
      pressed; ghost and icon buttons light on hover.
- [ ] The desk's colors (Settings → General, or the desk's right-click menu) are true black,
      neutral grays, and true white. One saved before they were neutral (a warm gray) comes
      back as its neutral one.
- [ ] Surfaces step in neutral grays, in both themes: the toolbar and view headers darkest
      (lightest gray in light), panels a step up, buttons raised a step more; panels meet
      the desk and each other at a dark hairline, with no rounded corners or shadows.
      Shadows only on things that float: menus, toasts, and dialogs.
- [ ] Amber only for selection (desk, sidebar, guides), the primary button (Export, Apply),
      active toggles (an amber icon), drop targets, progress, and links. The toolbar's
      wordmark is plain text; Preview is an ordinary button; selected segments, tabs, and
      Export's destination are gray. About keeps its amber wordmark.
- [ ] Panel headers (the sidebar's, tabs in Layout and Settings) are 28 px bars a step
      lighter than their panel, divided by a dark line. Section titles and labels are sans,
      not mono capitals; chrome text is 12 px. Buttons are 26 px (24 px in panels);
      segmented controls 24 px; Export's Quality slider is a thin track with a small knob.
- [ ] Icons are drawn with a fine (1.5) stroke. Scrollbars are thin and in the theme's colors
      in browsers that draw their own.

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
- [ ] A new project's empty desk: "Drop photos here, or add them." ("add them" opens the
      picker), in the default face, and a Page card with
      the same settings as Layout's Page tab (no Content), applied as they're picked (no Apply):
      picking Frames or a preset, then adding photos, keeps the choice. **[F]** It says to drag photos onto
      frames.

## Desk

- [ ] Add photos (⌘I or the button): progress in the status bar, then the photos at full size
      (sharp at 100% zoom), in rows of six below anything already on the desk, with the view
      zoomed to fit them. An unreadable file: "Couldn't read N files". In a private Safari window (where the browser won't store photos): "This browser won't store photos here…".
- [ ] Drop image files from the Finder: "Drop to add photos", then they're added.
- [ ] Drop a `.photo-sequence` file: "Drop to open project", then it opens after a confirm.
- [ ] Paste an image copied in another app (⌘V): added as "Pasted image HH.MM.png".
- [ ] _(e2e)_ Scroll or Space-drag pans; pinch or ⌘-scroll zooms around the cursor; the status bar's
      − and + zoom around the center; its percentage follows the zoom, and its menu has Show
      all photos, 50%, 100%, and 200%. The zoom controls hide while the editor is open.
- [ ] Click selects; Shift- or ⌘-click adds or removes; drag on empty desk to marquee-select;
      clicking empty desk clears.
- [ ] Dragging selected photos moves them together and brings them forward; one ⌘Z undoes it.
- [ ] Corner-handle resize keeps proportions; Shift resizes freely.
- [ ] Arrows nudge ⅛ in, Shift+arrows 1 in; a run of nudges is one undo step.
- [ ] ⌘A selects all, Delete removes, Escape clears the selection.
- [ ] _(e2e)_ Option-drag a desk photo (or a selection): copies go where they're dropped, the
      originals stay, the copies are selected; one undo step; they survive a reload with their
      own images. Option-drag onto a page places the copies there. Esc mid-drag: no copies.
- [ ] ⌘D duplicates (offset, selected, "… copy.jpg"). ⌘C then ⌘V pastes copies that step
      further each time; copying in the app and pasting into another app gives the image.
- [ ] Tap Space with photos selected: Quick Look (holding Space doesn't). ←/→ browse with a
      counter; click shows actual pixels and drag looks around; Space or Escape closes.
- [ ] Right-click the desk: Tidy up (or "Tidy up N photos") makes a grid; the desk color
      swatches change it at once.
- [ ] Right-click a photo: Quick Look, Copy image, Duplicate, Return to desk (placed photos),
      Delete ("Deleted … Undo to bring it back").
- [ ] With every photo placed: "Every photo is placed." above the same line.
- [ ] _(e2e)_ The status bar along the window's foot: what's selected ("2 photos selected", "1
      spread selected" / "1 frame selected"), else "4 on desk, 2 placed"; and while it's under way,
      progress: "Adding photos 3/12"
      with a bar (opening a project, making test images, too) or an export's "Rendering …".
      The toolbar shows no status of its own.

## Sidebar (spreads and frames)

- [ ] **[S≠F]** Heading "Spreads" [S] or "Frames" [F]. Scrolling the list shows "N pages" [S] /
      "N frames" [F] ("1 frame" for one) at its foot, gone a second after scrolling stops.
- [ ] One column to start; the header's slider sets 1–4 columns (as many as fit), and it
      survives a reload.
- [ ] **[S≠F]** Labels: 01, 02–03, …, the last single page [S]; 01, 02, 03… [F].
- [ ] Each cell is its thumbnail in a dark well with its number below; no grip dots (the whole
      cell drags). A selected cell is lighter, with a thin amber outline.
- [ ] **[S]** The first and last spreads don't drag ("The first and last pages stay in place"
      over their number) and have no delete button.
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

- [ ] The header has only the guides toggle and ×; the status bar says "Shift: free resize ·
      Option: no snapping, or drag a copy · Arrows nudge".
- [ ] _(e2e)_ Option-drag a placed photo: a copy ("… copy.jpg", selected) goes where it's dropped
      and the original stays; Option held means no snapping (let go of it mid-drag to snap). One
      undo step. Option-drag it onto the desk strip: the copy goes to the desk.
- [ ] _(e2e)_ Under the spread, ‹ "2 / 4" › (its place among all spreads or frames, not its page
      numbers); ‹ › (and ←/→ with nothing selected) go back and forth, disabled at the ends.
- [ ] _(e2e)_ Pinch or ⌘-scroll zooms around the pointer; scrolling pans; dragging, snapping, and
      dropping still land where they should when zoomed. Another spread opens fitted again.
- [ ] Click a strip photo: **[S]** placed on the first empty page, else the right; **[F]**
      placed on the frame.
- [ ] Drag a strip photo onto the page or frame: placed. Drag a placed photo onto the strip:
      back to the desk. The strip says "Desk · N", or "Empty…".
- [ ] Moving snaps to edges, center lines, border guides, and ruler guides, with feedback; Alt
      turns snapping off. **[S]** Photos snap to the gutter and can cross it.
- [ ] Corner resize keeps proportions and snaps; Shift resizes freely; Alt doesn't snap.
      **[px]** Resizing stops at 10 px.
- [ ] Arrows nudge 1/16 in (Shift ½ in) **[in]** or 1 px (Shift 10 px) **[px]**.
- [ ] Delete returns the selected photo to the desk; Escape deselects, then closes the editor;
      clicking the backdrop closes it.
- [ ] Hide guides (eye button or ⌘;): guides disappear; photos still snap to edges.
- [ ] **[S≠F]** Inspector: "Left page"/"Right page" [S] or "Frame" [F]; X/Y/W/H in inches
      **[in]** or whole px **[px]**, X from that page's left edge.
- [ ] Keep proportions on: changing W changes H and back; off: independent.
- [ ] After clicking Keep proportions (or any checkbox), Escape, Delete, and the arrows still
      work.
- [ ] _(e2e)_ Quality, as a sentence in the default face: "This image is N dpi." **[in]**, and "This
      image is 171 dpi, which is below the project's 300 dpi." in orange when the photo has
      fewer pixels than the page's dpi asks for (lowering the dpi in Layout clears it); "This
      image is enlarged N%." only when enlarged **[px]**. A photo stretched with Shift counts
      its thinner side.
- [ ] _(e2e)_ At the panel's foot: Return to desk (with a photo selected), and above it Go to next
      error, which selects the next photo below the resolution in book order (opening its
      spread; after the last, the first). It's gone when there's no other.
- [ ] A photo below the page's resolution has a warning mark (amber, on a rounded square) on
      it in the editor, and its
      spread's row in the sidebar has one, titled "N photos below 300 dpi" (or "enlarged").
- [ ] Center on page/frame and Fit page/frame work. "Fit … guide" buttons, largest first;
      hovering one makes its box glow; per-edge guides show a range and a hint.
- [ ] Right-click a placed photo → Duplicate: the copy is offset by a fortieth of the page's
      width (0.25 in on a 10 in page, about 27 px on a 1,080 px frame).
- [ ] Add a frame, open it, ⌘Z: the editor closes cleanly and desk shortcuts work.

## Pages

- [ ] _(e2e)_ The toolbar's switcher, centered: Desk · Preview · Export, the current one
      lighter. ⌥⌘1–⌥⌘3 go to each (Ctrl+Alt elsewhere); **[Mac]** so do View → Desk,
      Preview, Export, and the document's name sits after the traffic lights. Esc doesn't leave
      a page (pages aren't dismissed; the switcher changes them).
- [ ] Preview and Export fill the space under the toolbar, flush (no backdrop, corners, or ×); the
      status bar stays. The sidebar toggle shows only on the desk; zoom only on the desk.
- [ ] _(e2e)_ Closing Layout with unapplied page changes asks Apply / Discard / Cancel, however
      it's closed (×, Esc, ⌥⌘P, a page switch, a menu; **[Mac]** its window's close button);
      Cancel stays.
- [ ] Settings or About over a page close when going to another page.
- [ ] No grab or help cursors over photos or marks: the arrow throughout.
- [ ] A soft photo's "Show me" (Export) goes to the desk with it open in the editor.
- [ ] The tour's Layout step opens Layout on its Guides tab; its Preview step points at the
      switcher.

## Hints

- [ ] _(e2e)_ Hovering anything with a hint shows it at once in the status bar's left side, set like
      the rest of the status bar, in place of the counts; moving off brings the counts back.
      Nothing floats beside the pointer, anywhere.
- [ ] Tab to a control: its hint shows at once in the status bar.
- [ ] _(e2e)_ Settings opens over the page as the spread editor does: the toolbar and status bar stay
      in view, and its hints (the desk swatches) show there.

## Layout

- [ ] _(e2e)_ Opens from the toolbar's ruler icon (right, beside Settings), ⌥⌘P, or the empty
      desk's "Layout" link (**[Mac]** also View → Layout…): over the page as the spread
      editor is, on the website and in the Mac app alike (toolbar and status bar in view; ×,
      Esc, or ⌥⌘P closes it, and the status bar says what the page under it does again). ⌥⌘P works while typing in a field.
- [ ] Two tabs (underlined, like Settings'), Page and Guides; the tab is kept while the app is
      open.

### Page tab

- [ ] Nothing changes until Apply: Pages, size, unit, preset, dpi, and Content are a draft.
      The stage always shows the real spreads or frames, with ‹ › and ←/→ through them: as
      they are, or as they'd be after Apply once something changes, without the view
      switching. Revert drops the draft. The draft survives switching to Guides and back.
      Leaving Layout (the switcher, ⌥⌘ shortcuts, a menu) with changes waiting asks: Cancel, Discard, or
      Apply.
- [ ] With changes waiting, the Guides tab asks first, as closing does: Cancel stays on Page,
      Discard drops them, Apply applies them, then Guides opens.
- [ ] The pager says only "1 / 6". Apply and Revert stay at the panel's foot while the settings
      above scroll (a short window).
- [ ] The swap button between W and H swaps them (in the draft).
- [ ] The tab's rows line up: labels (Pages, Preset, Unit, Size, Resolution, Content) in a
      column at the left, controls beside them. Fields are inset wells with the unit
      inside (W 10 in, 300 dpi), no spinner arrows.
- [ ] _(e2e)_ Dragging left or right on a field's label or unit (W, H, in, dpi, a border guide's Top)
      scrubs the value; Shift steps by ten, Option by a tenth; a click there still lets you
      type. The new-project card's fields apply when the drag ends.
- [ ] **[S→F]** Frames, Apply: each page becomes a frame in book order (a photo across the
      gutter goes with the page holding its center), same size and unit. One ⌘Z undoes it.
- [ ] **[F→S]** Switching straight back restores the book exactly. After editing: frame 1 is
      the first page, the rest pair into spreads, a leftover becomes the last page.
- [ ] **[in→px]** Picking Pixels (Unit) fills the size converted at the dpi (10 × 8 in at 300 → 3000 ×
      2400); Apply as is converts, and photos keep their resolution. Resolution shows 1×.
- [ ] **[px→in]** Picking Inches (Unit) shows "Print at 300 dpi" and the size in inches (1080 px → 3.6 in);
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

- [ ] _(e2e)_ The switcher, ⌥⌘2, or ⌘P: opens on the spread being edited, else the first. The
      toolbar and status bar stay; the controls don't fade. The status bar says "← → to turn
      pages · F for fullscreen"; "2 / 4" sits just below the spread (no folio).
- [ ] →, Space, PageDown forward; ←, PageUp back; Home and End; arrow buttons disable at the
      ends. **[S]** Single pages on their side, with gutter shading.
- [ ] _(e2e)_ Fullscreen (or F) covers the window, toolbar and status bar too: the browser goes
      fullscreen on the web, the window in the Mac app. Its controls fade after the pointer
      rests about a second; moving or Tab brings them back; they stay while hovered and
      while saving. Its header says "← → to turn pages · Esc to leave fullscreen".
      The count under the spread fades too. **[Mac]** `npm run test:app` checks F, Esc, the
      green button, and Esc again. Exit fullscreen, F, or Esc leaves it (Esc again does nothing);
      leaving fullscreen with the browser's own Esc or the green button does too.

## Exports and project files

- [ ] Layout's and Export's stages are the desk's color (change it in the desk's menu).
- [ ] **[S]** Export's preview, one per spread: the first and last single pages show at the
      size of a page in a spread, not enlarged to fill.
- [ ] File → Export… (⌘⇧E), the switcher, or ⌥⌘3 opens the Export page: a preview of what it makes on the left,
      with ‹ › and ←/→ (not while Layout or Settings is over it), and the destination and its
      options on the right. Destinations: PDF,
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

- [ ] _(e2e)_ ⌘, opens on General: Theme, Desk color, Status bar (Show the status bar), and
      Shortcuts (Show shortcuts while ⌘ is held). "Instagram & storage" ("Instagram" in the Mac
      app) has Instagram, and Storage on the website. Advanced shows Server and Test images.
- [ ] _(e2e)_ Unchecking Show the status bar hides it (and its hints) at once; both settings survive
      a reload.
- [ ] **[Mac]** Settings (⌘, or the toolbar's gear) opens in a window of its own, titled
      Settings, not a dialog; asking again brings that one forward. ⌘W closes it. A line at its
      foot shows hints (a swatch's name). Changing the theme, desk color, status bar, or
      shortcuts there changes the main window at once; so does connecting or disconnecting
      Instagram. Advanced → Add test images adds them to the main window's desk.
      `npm run test:app` checks it opens once and that a setting reaches the main window.
- [ ] **[Mac]** In the Settings window, ⌘Z, ⇧⌘Z, and ⌘A edit the focused field there (not the
      project behind it, not the desk's photos). A sign-in message at its foot clears after a few
      seconds. Closing the main window, or ⌘Q, closes Settings too, so the app quits.
- [ ] **[Mac]** Connecting Instagram from the Settings window: the browser opens; coming back
      connects, shown in the Settings window (and Export in the main window).
- [ ] Advanced → Test images: a count (1–50, 6 to start) and Add test images. It closes
      Settings, the status bar counts "Making test images", then "Adding photos", then it imports like Add photos: "Gradient 01.jpg"…
      on the desk, in film colors that blend cleanly (no gray middles), about 3000 × 2000 px
      (portrait, landscape, or square), with no ring in the glow or vignette. One undo removes them.
- [ ] Theme: System, Light, Dark apply at once and survive a reload.
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
- [ ] **Mac app** (a bundled build: `npm run app:build`; links don't reach `tauri dev`):
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
- [ ] While posting, Escape, the switcher, ⌘P, ⌘, and New project don't leave the page or
      replace the pane.
- [ ] Done: "Posted to Instagram.", View on Instagram opens the post, Done closes. A failure
      shows its message and Post can be tried again.
- [ ] On Instagram: a carousel's slides are in order and cropped or expanded as chosen;
      stories in order.
- [ ] Against the dev server, after a post, a failure, and a cancel: in `server/`,
      `npm run metrics -- --dev` counts them this week as Posted, Failed, and Cancelled, with
      the uploads, images, and users.

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

- [ ] _(e2e)_ Hold ⌘ (Ctrl) for a moment: a badge below each button with a ⌘ shortcut, over
      everything (nothing covers them, the spread editor and Settings included): Undo, Redo,
      the three page buttons (⌥⌘1–⌥⌘3), Layout (⌥⌘P), the sidebar toggle, Settings, the editor's guides eye,
      and the empty desk's Add photos. A disabled button's badge is dimmed; releasing hides
      them. Off in Settings → General → Shortcuts, none show.
- [ ] ⌘I add, ⌘O open, ⌘S save, ⌘⇧E export, ⌘P preview, ⌘; guides, ⌘,
      settings, ⌘B sidebar.
- [ ] Desk shortcuts (⌘A, ⌘C, ⌘D, Delete, arrows, Escape) do nothing on another page, or while
      a dialog or the editor is open.

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
- [ ] Opening a project from a newer version says to update from the App Store (no Reload).
- [ ] The icon (Dock, Finder, the About window) is the stack of frames: white in light mode,
      black in dark mode (macOS 26 and later, following System Settings → Appearance); the
      white one on older macOS.

## Landing page (web)

- [ ] `/` shows the headline, Try it online (opens `/app/`), and the Mac App Store badge; paper
      in a light color scheme, near-black in dark, with no accent color.
- [ ] The screenshots (desk, spreads, preview, Instagram) turn with ‹ ›, ←/→, or their
      captions, wrapping around at the ends. On a wide screen the content stays within about
      150 px of the screenshot on each side, while the dividers run edge to edge; at phone
      width nothing scrolls sideways.

## Icons (web)

- [ ] The browser tab's favicon is the white stack in a light color scheme and the black one
      in dark (Chrome, Firefox; Safari may keep the white one).
- [ ] Adding the site to a home screen or installing it as an app shows the white stack.
