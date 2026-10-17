import { openUrl } from '@tauri-apps/plugin-opener';
import { ui } from '../../ui';
import type { Platform } from '../types';
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

/**
 * The Mac app. Projects are documents: saved to .photo-sequence files, which open with
 * a double-click (see ./documents.ts). There's a menu bar (./menu.ts), and files are
 * written through the app's Rust side (./files.ts, src-tauri/src/lib.rs).
 */
export const platform: Platform = {
  kind: 'macos',

  start() {
    // Room for the traffic lights in the toolbar, which is also the title bar.
    document.documentElement.classList.add('native-app');
    void import('./menu').then((m) => m.setUpMenu());
    void loadDocuments().then((m) => m.startDocuments());
    if (__E2E__) void import('./e2e').then((m) => m.runE2E());

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
};
