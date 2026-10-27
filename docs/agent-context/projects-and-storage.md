# Projects and storage

## In the browser

The web app keeps the project in the browser (IndexedDB) and saves as it goes. Only one tab
edits at a time; others show why they're blocked. Installing the app (Chrome or Edge: the
install icon in the address bar; Safari: File → Add to Dock) makes the browser less likely to
clear stored work; Settings shows whether storage is protected. Exporting is the backup.

## Offline and updates

The deployed app works offline once it has loaded: a service worker scoped to `/app/` keeps
a copy of the whole app. New versions download in the background; the app says a new version
is available and switches on reload.

## Project files

File → Save project saves a `.photo-sequence` file, a ZIP inside, that opens anywhere:

```
photo-book-2026-09-26.photo-sequence
├── project.json   # layout, settings, and Export choices (versioned: see src/schema.ts)
├── images/        # the original files
└── thumbs/        # display copies
```

Dropping a project on the desk opens it. Plain `.zip` files with the same contents work too.

## The Mac app

In the Mac app, projects are documents: `.photo-sequence` files open with a double-click,
File → Save keeps the project in its file, and the window's title shows unsaved changes. The
app runs in the App Sandbox (`src-tauri/Entitlements.plist`), so it can use only the files the
user picks or opens, and keeps bookmarks to them so a project can still be saved after a
restart.
