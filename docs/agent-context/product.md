# The product

Sequence is a tool for playing with photo sequences: putting photos in order for a book, a
zine, slides, or an Instagram carousel. It's a web app at sequence.photos/app/ and a Mac app
on the App Store; both work offline and keep everything on the user's machine (only posting
to Instagram goes through a server).

## The desk and the sidebar

Photos are added to the desk, a free canvas, and placed onto spreads (or frames) in the
sidebar. Right-click the desk to tidy photos into a grid or change the desk color. Double-
click a spread to open it in the spread editor, where photos are moved, sized, and cropped on
the page. Quick Look (Space) shows photos full size. Double-click a photo (or right-click → Crop… or Crop to ›) to crop it: the crop stays with the photo wherever it goes, and every export shows only the crop.

The toolbar switches between three pages: the desk, Preview (every page in order, with a
fullscreen option), and Export. The status bar at the bottom shows counts, zoom, and hints
for what's under the pointer, in place of tooltips.

## Spreads or frames, inches or pixels

A project is spreads (facing pages, like a book) or frames (single pages in order, like
slides or a carousel), measured in inches (with a resolution, 300 dpi by default) or pixels.
It's chosen in Layout → Page, or from a preset (Book, Zine, Slides, Instagram's sizes).
Changes wait for Apply, with a preview of every page, and apply as one undo step.

Switching to frames breaks spreads into pages, each photo going with the page that holds its
center; going back, frame 1 becomes the first page and the rest pair into spreads. Photos
with less detail than the resolution asks for are marked.

## Guides

Layout → Guides sets up the guides photos snap to, on every spread and mirrored on facing
pages:

- Center lines.
- Border guides: a distance from each edge (top, bottom, inside at the gutter, and outside;
  left and right on a frame). Photos dropped on a page fit inside the one marked On drop.
- Straight guides dragged out of the rulers. Shift snaps to ⅛ in (or 10 px); dragging one
  off the page removes it.

Clicking a guide highlights its settings. Guides can be hidden for now (not saved).

## Shortcuts

⌘ on the Mac, Ctrl elsewhere. Holding the modifier shows each button's shortcut (a setting).

| Action                   | Shortcut                            |
| ------------------------ | ----------------------------------- |
| Add photos               | ⌘I                                  |
| Desk, Preview, Export    | ⌥⌘1, ⌥⌘2 (or ⌘P), ⌥⌘3 (or ⇧⌘E)      |
| Layout                   | ⌥⌘P                                 |
| Settings                 | ⌘,                                  |
| Open, save project       | ⌘O, ⌘S                              |
| Show or hide the sidebar | ⌘B                                  |
| Show or hide guides      | ⌘;                                  |
| Copy, paste, duplicate   | ⌘C, ⌘V, ⌘D                          |
| Duplicate by dragging    | Option-drag (desk or spread editor) |
| Quick Look               | Space                               |
| Undo, redo               | ⌘Z, ⇧⌘Z (Ctrl+Y)                    |

The code is the source of truth (`src/commands.ts`; the menus in `src/components/Menu.tsx` and `src/platform/macos/menu.ts`).

## The tour

File → Take the tour walks through the app with the six sample photos in `src/tour/` (it
also runs on the first visit). The user's own project is set aside while it runs and comes
back when it ends. Those six photos are the only ones used in public materials.
