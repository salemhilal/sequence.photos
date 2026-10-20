import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { projectLoaded } from '../../persistence';
import { createPref } from '../../prefs';
import { buildProjectFile, confirmReplace, importProject, PROJECT_EXTENSION, ProjectFileError } from '../../project';
import { projectStore } from '../../store';
import { endTour } from '../../tour';
import type { Project } from '../../types';
import { ask, ui } from '../../ui';
import { chooseSaveLocation, writeFile } from './files';

/**
 * The Mac app's documents. The project is saved to a .photo-sequence file (the same
 * format the website exports), which is the lasting copy: double-clicking one in Finder
 * opens it here. Between saves, the working copy is kept in the app (as on the website),
 * so unsaved changes survive quitting; the window's title says when there are some.
 */

/** The project's file, when it has one. */
interface OpenFile {
  path: string;
  /** Lets the file be saved after the app restarts (see bookmarks in src-tauri/src/lib.rs); null if none could be made. */
  bookmark: string | null;
  /** The project as last saved there (or opened from it); null when that's unknown (remembered with changes). */
  saved: Project | null;
}

let file: OpenFile | null = null;

interface RememberedFile {
  path: string;
  clean: boolean;
  bookmark?: string;
}

/** Remembered across launches, since the working copy is too. */
const filePref = createPref<RememberedFile | null>(
  'photobook-document',
  null,
  (raw) => {
    const v = JSON.parse(raw) as Partial<RememberedFile> | null;
    if (typeof v?.path !== 'string') return undefined;
    return {
      path: v.path,
      clean: v.clean === true,
      ...(typeof v.bookmark === 'string' && { bookmark: v.bookmark }),
    };
  },
  JSON.stringify,
);

/** The project now lives at `path`, as `saved`: remember the file, with a bookmark to it. */
async function attach(path: string, saved: Project): Promise<void> {
  let bookmark: string | null = null;
  try {
    const bytes = await invoke<number[]>('bookmark_file', { path });
    bookmark = btoa(String.fromCharCode(...bytes));
  } catch {
    // Without one, saving after a restart asks where (see save).
  }
  file = { path, bookmark, saved };
}

/** Whether there's anything the file doesn't have. */
function edited(): boolean {
  if (file?.saved) return projectStore.project !== file.saved;
  return Object.keys(projectStore.project.photos).length > 0 || projectStore.getSnapshot().canUndo;
}

/** Whether the project is safe in its file, so replacing it loses nothing. */
export function isSaved(): boolean {
  return file !== null && !edited();
}

/** The project's file name without its extension, or null if it hasn't been saved yet. */
export function documentName(): string | null {
  return file ? name() : null;
}

function name(p = file?.path): string {
  const base = p?.split('/').pop() ?? 'Untitled';
  return base.endsWith(PROJECT_EXTENSION) ? base.slice(0, -PROJECT_EXTENSION.length) : base;
}

function remember(): void {
  filePref.save(file ? { path: file.path, clean: !edited(), ...(file.bookmark && { bookmark: file.bookmark }) } : null);
}

let shownTitle = '';
function showState(): void {
  // During the tour, the sample project is showing; the user's file is untouched.
  const touring = ui.get().tour !== null;
  const title = touring ? 'Sequence' : `${name()}${edited() ? ' — Edited' : ''}`;
  if (title === shownTitle) return;
  shownTitle = title;
  // The window's own title is hidden (the toolbar shows it), but the Window menu,
  // Mission Control and the Dock still use it.
  void getCurrentWindow().setTitle(title);
  ui.set({
    windowTitle: touring ? { name: 'Sequence', edited: false } : { name: name(), edited: edited() },
  });
  if (ui.get().tour === null) remember();
}

/**
 * Forget the file (after starting a new project, or importing one without a known
 * location). Like opening a file, this starts fresh history: undo can't lead back into a
 * project whose file is no longer attached.
 */
export function forgetFile(): void {
  projectStore.reset(projectStore.project);
  file = null;
  showState();
  remember();
}

/** Save over the project's file (or ask where, if it has none). Resolves to whether it was saved. */
export async function save(): Promise<boolean> {
  return file ? writeTo(file.path) : saveAs();
}

/** Save to a new file, asking where first (`target` skips asking; the end-to-end test uses it). */
export async function saveAs(target?: string): Promise<boolean> {
  const chosen = target ?? (await chooseSaveLocation(`${name()}${PROJECT_EXTENSION}`));
  return chosen ? writeTo(chosen) : false;
}

async function writeTo(target: string): Promise<boolean> {
  if (ui.get().busy || ui.get().importing || ui.get().tour !== null) return false;
  const project = projectStore.project;
  try {
    const file = await buildProjectFile('Saving');
    await writeFile(target, file, (f) => ui.set({ busy: `Saving… ${Math.round(f * 100)}%` }));
  } catch (e) {
    ui.set({ notice: `Couldn't save “${name(target)}”${typeof e === 'string' ? `: ${e}` : '.'}` });
    return false;
  } finally {
    ui.set({ busy: null });
  }
  // Changes made while saving aren't in the file.
  await attach(target, project);
  showState();
  remember();
  return true;
}

/** File → Open. */
export async function openWithDialog(): Promise<void> {
  const chosen = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: 'Sequence project', extensions: [PROJECT_EXTENSION.slice(1)] }],
  });
  if (typeof chosen === 'string') await openPath(chosen);
}

/** Resolves once nothing is being imported, saved or opened. */
function idle(): Promise<void> {
  const quiet = () => !ui.get().importing && !ui.get().busy;
  if (quiet()) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = ui.subscribe(() => {
      if (!quiet()) return;
      stop();
      resolve();
    });
  });
}

/** Opens run one at a time, each after anything else in progress. */
let opening = Promise.resolve();

/**
 * Open a project file (from File → Open, or Finder). `launching`: this file is why the
 * app started, so it takes over from the last session's project without asking.
 */
export function openPath(target: string, launching = false): Promise<void> {
  opening = opening
    .then(async () => {
      await idle();
      await open(target, launching);
    })
    // One failed open mustn't stop the ones after it.
    .catch(() => {});
  return opening;
}

async function open(target: string, launching: boolean): Promise<void> {
  // Opened from Finder mid-tour: the tour gives way.
  endTour();
  if (!launching) {
    if (target === file?.path && !edited()) return;
    const hasWork = Object.keys(projectStore.project.photos).length > 0;
    if (hasWork && !(await confirmReplace('Open another project?', `“${name(target)}”`, 'Open'))) return;
  }
  try {
    ui.set({ busy: 'Opening project…' });
    const bytes = await invoke<ArrayBuffer>('read_project', { path: target }).finally(() => ui.set({ busy: null }));
    await importProject(new File([bytes], target.split('/').pop() ?? 'project'));
    // Undo shouldn't lead back into a different file's project.
    projectStore.reset(projectStore.project);
    await attach(target, projectStore.project);
    // The title bar names the file; the import's "undo to go back" no longer applies.
    ui.set({ selection: [], editingSpreadId: null, page: 'desk', modal: null, notice: null });
    showState();
    remember();
  } catch (e) {
    ui.set({ notice: e instanceof ProjectFileError ? e.message : `Couldn't open “${name(target)}”.` });
  }
}

/** Before the window closes with changes the file doesn't have, offer to save them. */
async function confirmClose(): Promise<boolean> {
  // Mid-tour, the sample project is showing; bring back the user's before judging it.
  endTour();
  if (!edited()) return true;
  const choice = await ask({
    title: `Save changes to “${name()}”?`,
    message: "Unsaved changes are kept in the app for next time, but they're only safe once they're in a file.",
    actions: [
      { label: 'Don’t Save', value: 'discard' },
      { label: 'Cancel', value: 'cancel' },
      { label: 'Save', value: 'save', primary: true },
    ],
  });
  if (choice === 'save') return save();
  return choice === 'discard';
}

export async function startDocuments(): Promise<void> {
  await projectLoaded;
  // Pick up the last session's project; a file the app was launched to open replaces it
  // below (and if that file can't be opened, the last session's stays, file and all).
  const launchedWith = (await invoke<string[]>('take_opened_files')).at(-1);
  const remembered = filePref.load();
  if (remembered) {
    const { bookmark = null } = remembered;
    const saved = remembered.clean ? projectStore.project : null;
    let path = remembered.path;
    // Get access to the file again, wherever it is now.
    if (bookmark) {
      const bytes = Uint8Array.from(atob(bookmark), (c) => c.charCodeAt(0));
      path = await invoke<string>('open_bookmark', { bookmark: [...bytes] }).catch(() => path);
    }
    file = { path, bookmark, saved };
  }
  showState();
  projectStore.subscribe(showState);
  ui.subscribe(showState);

  // Closing the main window (its button, ⌘W, or Quit) closes the app: Settings goes too,
  // since the menu bar belongs to this window and wouldn't work without it.
  const win = getCurrentWindow();
  void win.onCloseRequested(async (e) => {
    e.preventDefault();
    if (!(await confirmClose())) return;
    for (const other of await getAllWindows()) if (other.label !== win.label) await other.destroy();
    await win.destroy();
  });

  // Files opened from Finder (or dropped on the Dock icon) while the app is running.
  const takeOpened = async () => {
    const paths = await invoke<string[]>('take_opened_files');
    const last = paths.at(-1);
    if (last) await openPath(last);
  };
  await listen('opened-files', () => void takeOpened());
  if (launchedWith) await openPath(launchedWith, true);
  await takeOpened();
}

/** Quit, after offering to save (the menu's Quit goes through closing the window). */
export function quit(): void {
  void getCurrentWindow().close();
}
