# The iPhone app

A first pass, not yet released. It's the Tauri shell built for iOS around a UI of its own
(`src/phone/`), sharing the model, crop, render plan, exports, and Instagram posting with
the web and Mac apps. In development it's also at `/phone/` on the dev server.

## What it does

- **Sequences only.** Frames, in pixels (Instagram's sizes, slides, or a custom size); no
  books, no inches.
- **Sequences** (the first screen): every project on the phone, most recently changed
  first. New, open, rename, delete. They're kept in the app's own storage, a list of
  projects rather than the web app's one; there are no project files yet.
- **Frames**: the sidebar as a grid. Tap a frame to edit it; hold and drag to move it; Select
  to duplicate or delete several. + adds photos from the library, each on a new frame, into
  the empty frames first, or onto the desk; or an empty frame. More: Frame size (presets or
  custom, the border guide, center lines; one undo step), Rename, Undo, Redo.
- **The editor**: one frame, with ‹ n / N › to the others. Photos move (snapping to the
  frame's edges and guides by their outer edge, border and all) and resize from their
  corners; pinch zooms. Below it, the desk: drag a photo up onto the frame to place it,
  and a placed photo down into the panel to put it back (always by dragging, never a tap).
  Tap the frame for its background (white or black, for it or every frame); tap a photo for
  its place and size, its border (0 to 6% of the frame's width, white or black, drawn
  outside the photo), Crop, Fit, Center, Duplicate. Undo and Redo are in the top bar.
- **Crop**: as on the desktop, with shapes, Reset, and the pin: pinned, the crop holds still
  and dragging moves the photo in it.
- **Export**: images (JPEG or PNG) through the share sheet (Save Images puts them in
  Photos), or a post to Instagram (feed or stories, slides, caption). Tagging people isn't
  there yet.

## Backgrounds and borders

A spread or frame can have a black background, and a placed photo a border (schema 7). Every
export draws them (the render plan carries them), and the desktop shows them, though only the
phone sets them for now.
