import { invoke } from '@tauri-apps/api/core';
import { emit, emitTo, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import { mayClose, setStatusBar, ui } from '../../ui';
import { projectStore } from '../../store';
import { toGuideId } from '../../ids';
import { isLayoutWindow, isMainWindow, isSettingsWindow } from '../../windowKind';
import { mirrorMainProject, serveLayoutWindow } from './mirror';
import type { MainRequest, Platform } from '../types';
import { chooseSaveLocation, writeFile } from './files';

// Documents and the menu bar build on the shared modules (projects, commands), which
// import this one; so they're loaded when the app starts, not when this module does.
type Documents = typeof import('./documents');
let documents: Documents | null = null;
const loadDocuments = async (): Promise<Documents> => (documents ??= await import('./documents'));

/**
 * An export's name in the save panel: after the document, as Mac apps do ("Trip.pdf",
 * "Trip (InDesign).zip", "Trip (images).zip"), or the given dated name for an untitled one.
 */
function suggestedName(filename: string): string {
  const named = documents?.documentName();
  if (!named) return filename;
  if (filename.endsWith('-indesign.zip')) return `${named} (InDesign).zip`;
  if (filename.endsWith('.zip')) return `${named} (images).zip`;
  return `${named}${filename.slice(filename.lastIndexOf('.'))}`;
}

/** The Settings and Layout windows' labels, and the events between the app's windows. */
const SETTINGS = 'settings';
const LAYOUT = 'layout';
const PREFS_CHANGED = 'prefs-changed';
const MAIN_REQUEST = 'main-request';

/**
 * The Mac app. Projects are documents: saved to .photo-sequence files, which open with
 * a double-click (see ./documents.ts). There's a menu bar (./menu.ts), and files are
 * written through the app's Rust side (./files.ts, src-tauri/src/lib.rs).
 */
export const platform: Platform = {
  kind: 'macos',

  start() {
    // The Settings and Layout windows are only that: no documents, menu bar, or toolbar of
    // their own. Layout edits the main window's project, through a copy kept in step.
    if (isMainWindow) {
      // Room for the traffic lights in the toolbar, which is also the title bar.
      document.documentElement.classList.add('native-app');
      void import('./menu').then((m) => m.setUpMenu());
      void loadDocuments().then((m) => m.startDocuments());
      serveLayoutWindow();
      if (__E2E__) void import('./e2e').then((m) => m.runE2E());
    } else if (isLayoutWindow) {
      mirrorMainProject();
      // Closing it with page changes waiting for Apply asks first, as the dialog does.
      void getCurrentWindow().onCloseRequested(async (e) => {
        if (!(await mayClose())) e.preventDefault();
      });
      if (__E2E__) {
        // The end-to-end test's hooks: add a guide when asked, and say how wide the page is.
        void listen('e2e-layout-act', () =>
          projectStore.apply((d) => void d.settings.lines.push({ id: toGuideId('e2e'), axis: 'vertical', at: 1 })),
        );
        void listen('e2e-layout-report', () => void emit('e2e-layout-width', projectStore.project.page.w));
      }
    } else if (isSettingsWindow && __E2E__) {
      // The end-to-end test's hooks in the Settings window: say it's up, and when asked, change
      // a setting or ask for test images (to check the main window follows).
      void listen('e2e-settings-act', () => setStatusBar(false));
      void listen('e2e-settings-add-images', () => platform.sendToMain?.({ kind: 'addTestImages', count: 1 }));
      void emit('e2e-settings-ready');
    }

    // Links to websites and email open in the user's browser and mail app, not in the app's window.
    document.addEventListener('click', (e) => {
      const href = (e.target as Element | null)?.closest?.('a[href]')?.getAttribute('href');
      if (!href || !/^(https?|mailto):/.test(href)) return;
      e.preventDefault();
      void openUrl(href);
    });
  },

  async saveFile(filename, make) {
    const path = await chooseSaveLocation(suggestedName(filename));
    if (!path) return false;
    const blob = await make();
    const busy = ui.get().busy;
    try {
      await writeFile(path, blob, (f) => ui.set({ busy: `Saving… ${Math.round(f * 100)}%` }));
    } finally {
      ui.set({ busy });
    }
    return true;
  },

  keepProject: async () => (await loadDocuments()).save(),
  keepProjectAs: async () => (await loadDocuments()).saveAs(),
  openProject: () => void loadDocuments().then((m) => m.openWithDialog()),
  // Until documents have loaded (a moment after starting), nothing is known to be saved.
  projectIsSafe: () => documents?.isSaved() ?? false,
  projectReplaced: () => void loadDocuments().then((m) => m.forgetFile()),

  openSignIn(url) {
    void openUrl(url);
    return 'browser';
  },

  onSignInReturn(finish, waiting) {
    // The app's links macOS has handed it (src-tauri/src/lib.rs), including one that came
    // before the page was ready. Taken only by the window waiting for one (the main window,
    // or Settings), which holds what finishing it needs.
    const take = async () => {
      if (waiting && !waiting()) return;
      for (const link of await invoke<string[]>('take_opened_links')) {
        const url = new URL(link);
        if (url.protocol === 'sequence-photos:' && url.host === 'instagram') finish(url.hash);
      }
    };
    void listen('opened-links', () => void take());
    void take();
  },

  prefsChanged() {
    void emit(PREFS_CHANGED);
  },

  onPrefsChanged(reload) {
    void listen(PREFS_CHANGED, reload);
  },

  openLayout() {
    void (async () => {
      const open = await WebviewWindow.getByLabel(LAYOUT);
      if (open) return void open.setFocus();
      new WebviewWindow(LAYOUT, {
        url: 'app/index.html?window=layout',
        title: 'Layout',
        width: 1180,
        height: 760,
        minWidth: 820,
        minHeight: 520,
        center: true,
        dragDropEnabled: false,
      });
    })();
  },

  openSettings() {
    void (async () => {
      const open = await WebviewWindow.getByLabel(SETTINGS);
      if (open) return void open.setFocus();
      new WebviewWindow(SETTINGS, {
        url: 'app/index.html?window=settings',
        title: 'Settings',
        width: 560,
        height: 540,
        minWidth: 480,
        minHeight: 360,
        center: true,
        dragDropEnabled: false,
      });
    })();
  },

  sendToMain(request) {
    void emitTo('main', MAIN_REQUEST, request);
  },

  onMainRequest(handle) {
    void listen<MainRequest>(MAIN_REQUEST, (e) => handle(e.payload));
  },

  setFullscreen(on) {
    void getCurrentWindow().setFullscreen(on);
  },

  watchFullscreen(change) {
    const win = getCurrentWindow();
    // Going in or out of fullscreen resizes the window.
    const stop = win.onResized(() => void win.isFullscreen().then(change));
    return () => void stop.then((f) => f());
  },
};
