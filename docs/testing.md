# Testing Sequence

What to check before a release: the automated checks, then a pass through the app by hand.
Tick items off as you go.

Tags: **[P]** print books only, **[D]** digital sequences only, **[P≠D]** behaves differently
in each. Untagged items apply to both. Test both layouts where it matters: make a book, then
switch it to digital in Layout (and back).

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
- [ ] File → New project… with photos: Cancel / Export current first / New project. New
      project empties everything; ⌘Z brings the old one back.
- [ ] A new project's empty desk: "Start by adding photos", Add photos, and a Layout card with
      the format and size. **[D]** It says to drag photos onto frames.

## Desk

- [ ] Add photos (⌘I or the button): progress in the status bar, then the photos at full size
      (sharp at 100% zoom), in rows of six below anything already on the desk, with the view
      zoomed to fit them. An unreadable file: "Couldn't read N files".
- [ ] Drop image files from the Finder: "Drop to add photos", then they're added.
- [ ] Drop a `.photo-sequence` file: "Drop to open project", then it opens after a confirm.
- [ ] Paste an image copied in another app (⌘V): added as "Pasted image HH.MM.png".
- [ ] Scroll or Space-drag pans; pinch or ⌘-scroll zooms around the cursor; the zoom buttons
      zoom around the center; clicking the percentage resets to 100%.
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
- [ ] With every photo placed: "Every photo is placed". The status bar's "N on desk · M placed"
      stays right.

## Sidebar (spreads and frames)

- [ ] **[P≠D]** Heading and count: "Spreads" and "N pages" [P]; "Frames" and "N frames" [D],
      and "1 frame" for one.
- [ ] **[P≠D]** Labels: 01, 02–03, …, the last single page [P]; 01, 02, 03… [D].
- [ ] **[P]** The first and last spreads have a locked grip ("The first and last pages stay in
      place") and no delete button.
- [ ] **[D]** A sequence's only frame can't be deleted or dragged; with more, any can.
- [ ] **[P≠D]** The header's +: a spread before the back page [P]; a frame at the end [D].
- [ ] Hover a gap and click "+ Add spread" / "+ Add frame": a new empty one appears there.
      **[D]** There are gaps before the first frame and after the last.
- [ ] Drag a row's header to reorder: the gap lights up and the row moves on release. **[P]**
      Not before the first or after the last spread. **[D]** To the very start or end works.
- [ ] Click a row: the editor opens on it, and the row is highlighted.
- [ ] A row's ×: deleted, its photos go back to the desk; if it was open, the editor closes.
- [ ] Drag desk photos onto a thumbnail: **[P]** onto the left or right page (highlighted);
      **[D]** onto the frame. They fit the On drop guide, centered.
- [ ] Drag desk photos onto a gap ("Drop to add a spread/frame"): a new one holding them.
- [ ] Drag a photo from one thumbnail to another spread or frame: it moves; onto the desk: it
      lands where dropped.
- [ ] Drag a photo a little and drop it back on its own page or frame: it stays exactly as it
      was.
- [ ] Widen the sidebar from its edge: between one column and a grid with no flicker at any
      width; double-click resets; the width survives a reload. **[D]** One column at the
      narrowest, two at the default width.
- [ ] ⌘B hides and shows it, and that survives a reload.

## Spread and frame editor

- [ ] **[P≠D]** The header shows the folio and size in inches [P] or px [D] (frame 3 is "03").
- [ ] ‹ › (and ←/→ with nothing selected) go back and forth, disabled at the ends.
- [ ] Click a strip photo: **[P]** placed on the first empty page, else the right; **[D]**
      placed on the frame.
- [ ] Drag a strip photo onto the page or frame: placed. Drag a placed photo onto the strip:
      back to the desk. The strip says "Desk · N", or "Empty…".
- [ ] Moving snaps to edges, center lines, border guides, and ruler guides, with feedback; Alt
      turns snapping off. **[P]** Photos snap to the gutter and can cross it.
- [ ] Corner resize keeps proportions and snaps; Shift resizes freely; Alt doesn't snap.
      **[D]** Resizing stops at 10 px.
- [ ] **[P≠D]** Arrows nudge 1/16 in (Shift ½ in) [P] or 1 px (Shift 10 px) [D].
- [ ] Delete returns the selected photo to the desk; Escape deselects, then closes; clicking
      the backdrop closes.
- [ ] Hide guides (eye button or ⌘;): guides disappear; photos still snap to edges.
- [ ] **[P≠D]** Inspector: "Left page"/"Right page" [P] or "Frame" [D]; X/Y/W/H in inches [P]
      or whole px [D], X from that page's left edge.
- [ ] Keep proportions on: changing W changes H and back; off: independent.
- [ ] After clicking Keep proportions (or any checkbox), Escape, Delete, and the arrows still
      work.
- [ ] **[P≠D]** Quality: "N ppi", warning under 200 ("may print soft") [P]; "Enlarged N% · may
      look soft" only when enlarged [D].
- [ ] Center on page/frame and Fit page/frame work. "Fit … guide" buttons, largest first;
      hovering one makes its box glow; per-edge guides show a range and a tooltip.
- [ ] Right-click a placed photo → Duplicate: the copy is visibly offset (about 27 px in a
      1,080 px frame).
- [ ] Add a frame, open it, ⌘Z: the editor closes cleanly and desk shortcuts work.

## Layout

- [ ] Opens from the toolbar's Layout button (Mac: View → Layout…). Escape, ×, or the
      backdrop close it, including right after clicking the format toggle or a checkbox.
- [ ] Picking For print or For digital changes nothing until Apply: the form shows that
      format's units and last size, with a note; Revert puts it back.
- [ ] **[P→D]** For digital, Apply: each page becomes a frame in book order (a photo across the
      gutter goes with the page holding its center), at the size in the form; guides in px.
      One ⌘Z undoes it.
- [ ] **[D→P]** Switching straight back restores the book exactly. After editing: frame 1 is
      the first page, the rest pair into spreads, a leftover becomes the last page.
- [ ] Each format remembers its own last size.
- [ ] Size: editing W or H shows Apply (primary) and Revert; Revert restores; Apply resizes in
      one undo step; Enter applies. 10 → 8 → 10 puts photos and guides back exactly.
- [ ] **[D]** A new sequence is 1080 × 1350 (4:5). Presets: Instagram 4:5, 3:4 (app uploads),
      square, landscape, story; a custom size shows
      "Custom".
- [ ] **[P≠D]** Smallest size 1 in [P] or 100 px [D].
- [ ] Keep photos relative to guides: on, photos follow the guides on resize; off, they stay
      put; the help text changes.
- [ ] Center lines: Vertical and Horizontal show or hide the magenta lines here and in the
      editor.
- [ ] Border guides: + adds one further in; linked values change all four; unlinking allows
      per-edge values; relinking takes the top's. **[P≠D]** Edges are Inside/Outside, mirrored
      on facing pages [P], or Left/Right [D].
- [ ] On drop picks the guide dropped photos fit; removing it falls back to the largest; ×
      removes a guide; values can't push the box off the page.
- [ ] Ruler guides: drag from a ruler with a "N from …" label; Shift snaps to ⅛ in [P] or 10 px
      [D]; dragging off removes; clicking selects and opens its section; Delete removes the
      selected guide. **[P≠D]** Rulers mirror from each outside edge [P] or run from the left
      [D]. Long px labels turn to fit.
- [ ] The Guides section's buttons add a guide at a third; its field moves it (whole px [D]).
- [ ] Sections fold by their titles; folding survives a reload.

## Preview

- [ ] ⌘P or the toolbar: opens on the spread being edited, else the first. **[P≠D]** The
      button says "Preview book" [P] or "Preview" [D].
- [ ] →, Space, PageDown forward; ←, PageUp back; Home and End; arrow buttons disable at the
      ends. **[P]** Single pages on their side, with gutter shading.
- [ ] Folio and "n / total" are right.
- [ ] Controls fade after the pointer rests about a second; moving or Tab brings them back;
      they stay while hovered and while saving.
- [ ] **[P≠D]** The header button: Download PDF [P] or Export frames as images [D], with progress.
- [ ] Escape, Exit preview, or ⌘P closes.

## Exports and project files

- [ ] **[P]** PDF (⌘⇧P): a page per spread at true size, single first and last pages, photos
      cropped at the edges, no guides; `photo-book-DATE.pdf`.
- [ ] **[D]** PDF: a page per frame, 1 pt per px; titled "Sequence", `sequence-DATE.pdf`.
- [ ] **[P]** Export for InDesign: a ZIP with an `.idml` and `Links/`; opens in InDesign with
      facing pages, margins from the On drop guide, ruler guides, linked photos.
- [ ] **[D]** Export for InDesign is absent (web) or disabled (Mac). **[P]** Export frames as images is
      absent or disabled.
- [ ] **[D]** Export frames as images (⌘⇧E): `sequence-DATE.zip` with 01.jpg, 02.jpg… at the frame's size,
      on white.
- [ ] Export project (⌘S) and import it into a fresh project (⌘O): "Opened … · N photos. Undo
      to go back."; ⌘Z restores. A digital project comes back digital.
- [ ] A project from an older version opens as a book with its guides.
- [ ] A damaged file: "The project file is damaged." A ZIP that isn't a project: "This file
      isn't a Sequence project." Either way the current project is untouched.
- [ ] A project from a newer version: the "saved by a newer version" screen with Reload.

## Settings

- [ ] ⌘, opens on General; Advanced shows Server; tabs switch.
- [ ] Appearance: System, Light, Dark apply at once and survive a reload.
- [ ] Desk color: the swatches match the desk's menu and survive a reload.
- [ ] Storage (web): usage and Protected or not; Protect storage asks the browser.
- [ ] Server: Sequence, Development, or Local (an `http://localhost` address; Save only when
      valid and changed). Survives a reload. Running locally (`npm run dev`), the default is
      Development. The help says it applies the next time you connect Instagram.

## Instagram (web)

Posts made while testing are real and public. Use a test account, or delete them after.

### Connecting

- [ ] Settings → Connect Instagram: "Opening Instagram…", then Instagram's sign-in (no
      Facebook option; it asks for basic access and publishing only).
- [ ] Finish signing in: back in the app, the address bar has no `#instagram=…`, a notice says
      "Connected to Instagram as @user", and Settings shows it.
- [ ] Cancel at Instagram: back with nothing said. A personal account, or a missing
      permission: the matching message in place of Settings' description.
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

- [ ] File → Post to Instagram… is always listed. It's disabled, with the reason under it, unless
      the project is digital and Instagram is connected ("Needs a digital project…", "Connect
      Instagram in Settings first.", "Reconnect Instagram in Settings first.").
- [ ] The pane: @user in the header; Feed post or Stories; "A carousel of N frames" / "N
      stories, one per frame".
- [ ] Preview: arrows and ←/→; feed shows dots and "n/N", a white card, and the caption with
      blue hashtags and mentions; stories show progress bars on a 9:16 screen.
- [ ] Frames outside 4:5 to 1.91:1 (feed), or too tall for stories: Size offers Crop or Expand
      to the nearest shape; the preview and help follow.
- [ ] Caption: "n / 2,200" and "n / 30 hashtags"; over either turns red and disables Post.
      Stories say they have no captions.
- [ ] Empty frames: "Skip N empty frames", on by default. Nothing to post: "There are no frames
      with photos to post."
- [ ] More than 10 frames: only the first 10 will be posted (feed and stories), and the
      preview shows 10.
- [ ] Post: Preparing and Uploading frame n of N, Instagram processing, Publishing. Cancel
      until publishing: "Cancelled. Nothing was posted." and nothing appears on Instagram.
- [ ] While posting, Escape, ×, the backdrop, ⌘P, ⌘, and New project don't close or replace
      the pane.
- [ ] Done: "Posted to Instagram.", View on Instagram opens the post, Done closes. A failure
      shows its message and Post can be tried again.
- [ ] On Instagram: a carousel's frames are in order and cropped or expanded as chosen;
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
- [ ] ⌘I add, ⌘O open, ⌘S export/save, ⌘⇧P PDF, ⌘⇧E images [D], ⌘P preview, ⌘; guides, ⌘,
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
- [ ] Menus in title case with shortcuts. File: New Project, Open…, Add Photos…, Close, Save,
      Save As… (⌘⇧S), Save PDF…, Export for InDesign… [P], Export Frames as Images… [D].
- [ ] View: Preview, Layout…, Hide/Show Guides, Hide/Show Spreads [P] or Frames [D], following
      their state.
- [ ] Edit: Cut, Copy, Paste in text fields; Copy with photos selected copies them; Undo
      follows the project (and text fields while typing).
- [ ] Save writes the file and clears "Edited"; Save As… asks where; Open… and double-clicking
      a `.photo-sequence` open it; after a relaunch, Save still writes the same file.
- [ ] Quitting or closing with unsaved changes asks to save; unsaved changes survive a quit
      and relaunch.
- [ ] Save PDF…, Export Frames as Images…, and Export for InDesign… suggest the document's name ("Trip.pdf",
      "Trip (images).zip", "Trip (InDesign).zip"); an untitled project gets a dated name.
- [ ] Settings is one page (Appearance, Desk), with no tabs; no Instagram and no Storage section.
- [ ] Opening a project from a newer version says to update from the App Store (no Reload).
