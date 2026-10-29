import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Platform } from './types';

/**
 * The iPhone app: the phone UI (src/phone/) in a native window. Projects stay in the app's
 * own storage (see src/phone/library.ts), so there are no project files to open or save;
 * what it makes leaves through the share sheet. Instagram's sign-in opens in Safari and
 * comes back through the app's link, as in the Mac app (src-tauri/src/lib.rs).
 */
export const platform: Platform = {
  kind: 'ios',

  start() {
    // Links to websites and email open in Safari and Mail, not in the app's window.
    document.addEventListener('click', (e) => {
      const href = (e.target as Element | null)?.closest?.('a[href]')?.getAttribute('href');
      if (!href || !/^(https?|mailto):/.test(href)) return;
      e.preventDefault();
      void openUrl(href);
    });
  },

  async saveFile(filename, make) {
    const blob = await make();
    const file = new File([blob], filename, { type: blob.type });
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch {
      return false;
    }
  },

  // Projects are kept as they change; there's nothing more to keep, open, or lose.
  keepProject: async () => true,
  openProject: () => {},
  projectIsSafe: () => true,
  projectReplaced: () => {},

  openSignIn(url) {
    void openUrl(url);
    return 'browser';
  },

  onSignInReturn(finish, waiting) {
    // The app's links iOS has handed it (src-tauri/src/lib.rs), including one that came
    // before the page was ready.
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

  // One window, and no other tabs: settings changes have nowhere else to go.
  prefsChanged() {},
  onPrefsChanged() {},

  // Always the whole screen.
  setFullscreen() {},
  watchFullscreen: () => () => {},
};
