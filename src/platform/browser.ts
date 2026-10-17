import { download, pickFiles } from '../files';
import { buildProjectFile, openProjectFile, PROJECT_ACCEPT, PROJECT_EXTENSION } from '../project';
import { requestPersistence } from '../storage';
import { projectStore } from '../store';
import { ui } from '../ui';
import { startOfflineSupport } from '../update';
import { ZipTooLargeError } from '../zip';
import type { Platform } from './types';

/**
 * The website. Work lives in the browser's storage; exporting a project file is how
 * you keep a copy, and opening one replaces what's there.
 */
export const platform: Platform = {
  kind: 'browser',

  start() {
    startOfflineSupport();
    keepStorageOnceThereAreFiles();
  },

  async saveFile(filename, make) {
    download(await make(), filename);
    return true;
  },

  async keepProject() {
    if (ui.get().busy || ui.get().importing) return false;
    if (!Object.keys(projectStore.project.photos).length) {
      ui.set({ notice: 'Add some photos before exporting.' });
      return false;
    }
    try {
      const file = await buildProjectFile();
      download(file, `photo-book-${new Date().toISOString().slice(0, 10)}${PROJECT_EXTENSION}`);
      return true;
    } catch (e) {
      ui.set({ notice: e instanceof ZipTooLargeError ? e.message : "Couldn't export the project." });
      return false;
    }
  },

  openProject() {
    if (ui.get().importing) return;
    pickFiles(PROJECT_ACCEPT, false, ([file]) => file && void openProjectFile(file));
  },

  projectIsSafe: () => false,
  projectReplaced() {},

  openSignIn(url) {
    location.assign(url);
    return 'here';
  },

  onSignInReturn(finish) {
    const { hash } = location;
    if (!/[#&]instagram(_error)?=/.test(hash)) return;
    // Out of the address bar right away (it's useless without this tab's verifier, but still).
    history.replaceState(history.state, '', location.pathname + location.search);
    finish(hash);
  },
};

/** Once the project has photos, ask (once) for the browser not to clear its storage. */
function keepStorageOnceThereAreFiles(): void {
  const stop = projectStore.subscribe(() => {
    if (!Object.keys(projectStore.project.photos).length) return;
    stop();
    void requestPersistence();
  });
}
