import { applyDeskColor } from './deskColor';
import type { DropTarget } from './drag';
import type { Destination } from './exportOptions';
import type { PhotoId, SpreadId } from './ids';
import {
  deskColorPref,
  shortcutBadgesPref,
  sidebarOpenPref,
  sidebarWidthPref,
  statusBarPref,
  themePref,
} from './prefs';
import { createStore } from './store';
import { applyTheme, type ThemePref } from './theme';

/**
 * UI state that isn't part of the document or its undo history: selection,
 * open panels, drag feedback, and per-browser preferences.
 */

export interface DeskView {
  panX: number;
  panY: number;
  zoom: number;
}

export interface Ghost {
  photoId: PhotoId;
  count: number;
  clientX: number;
  clientY: number;
  w: number;
  h: number;
}

export type ContextMenuState =
  { kind: 'desk'; x: number; y: number } | { kind: 'photo'; x: number; y: number; photoId: PhotoId };

export interface ConfirmAction<T extends string = string> {
  label: string;
  value: T;
  primary?: boolean;
}

/**
 * An in-app confirmation showing: the dialog calls `choose` with the index of the action
 * picked, or null if dismissed (`ask` turns that back into the action's value).
 */
export interface ConfirmRequest {
  title: string;
  message: string;
  actions: readonly Omit<ConfirmAction, 'value'>[];
  choose: (index: number | null) => void;
}

/** The dialogs over a page: Settings and Layout (each its own window in the Mac app), and About. */
export type Modal = 'settings' | 'about' | 'layout';

/** The window's pages, switched from the toolbar: the desk, Preview, and Export. */
export type Page = 'desk' | 'preview' | 'export';

/** The Layout view's tabs: the page's settings (applied together), or the guides (applied at once). */
export type LayoutTab = 'page' | 'guides';

export interface UiState {
  selection: PhotoId[];
  editingSpreadId: SpreadId | null;
  /** The page shown under the toolbar. */
  page: Page;
  /** The preview, fullscreen: the toolbar and status bar hide. */
  presenting: boolean;
  /** The open dialog, if any. (The spread editor is tracked by editingSpreadId.) */
  modal: Modal | null;
  view: DeskView;
  ghost: Ghost | null;
  /** The drop target under the pointer during a drag, for highlighting (compare with `sameTarget`). */
  hover: DropTarget;
  /** Photos being added (or made, or a project opening), for the desk's progress toast; `label` says which. */
  importing: { done: number; total: number; label?: string } | null;
  /** Status text for long-running work like exporting. */
  busy: string | null;
  /** The hint for what's under the pointer (its `data-tip`), shown in the status bar. */
  hint: string | null;
  /** What the page other than the desk says in the status bar (its size, which page is shown). */
  pageStatus: string | null;
  notice: string | null;
  /** True while the shortcut modifier is held, to reveal shortcut hints. */
  hints: boolean;
  theme: ThemePref;
  /** Whether the status bar shows (a setting). */
  statusBar: boolean;
  /** Whether holding the shortcut modifier shows each button's shortcut (a setting). */
  shortcutBadges: boolean;
  sidebarOpen: boolean;
  /** Guides hidden for now (not saved): pages show without them, and photos snap only to page edges. */
  guidesHidden: boolean;
  /** Preferred sidebar width in px (clamped to the window when shown). */
  sidebarWidth: number;
  deskColor: string;
  contextMenu: ContextMenuState | null;
  confirm: ConfirmRequest | null;
  /**
   * Why this window shows (and saves) nothing, if it doesn't: the saved project is from a
   * newer version of the app (until a reload), or another tab or window is the one editing.
   */
  blocked: null | 'outdated' | 'elsewhere';
  /** A new version of the app has downloaded and is waiting for a reload. */
  updateReady: boolean;
  /** The last save failed (e.g. storage full); cleared by the next successful save. */
  saveFailed: boolean;
  /** Photos open in Quick Look, and which one is showing. */
  quickLook: { ids: PhotoId[]; index: number } | null;
  /** Mac app: the project's name and whether it has unsaved changes, shown centered in the toolbar. */
  windowTitle: { name: string; edited: boolean } | null;
  /** The product tour's current step, while it's running (see tour.ts). */
  tour: number | null;
  /** The Layout view's open tab. */
  layoutTab: LayoutTab;
  /** A photo for the spread editor to select when it opens ("Show me"), then cleared. */
  editorSelect: PhotoId | null;
  /** Where the Export view exports to: the last one picked, for now (not saved); null till then. */
  exportTo: Destination | null;
  /**
   * Spreads (or frames) selected in the sidebar, to delete or move together. Selecting
   * them clears the desk's selection, and the other way around.
   */
  spreadSelection: SpreadId[];
}

export const ui = createStore<UiState>({
  selection: [],
  editingSpreadId: null,
  page: 'desk',
  presenting: false,
  modal: null,
  view: { panX: 40, panY: 40, zoom: 1 },
  ghost: null,
  hover: null,
  importing: null,
  busy: null,
  pageStatus: null,
  hint: null,
  notice: null,
  hints: false,
  theme: themePref.load(),
  statusBar: statusBarPref.load(),
  shortcutBadges: shortcutBadgesPref.load(),
  sidebarOpen: sidebarOpenPref.load(),
  guidesHidden: false,
  sidebarWidth: sidebarWidthPref.load(),
  deskColor: deskColorPref.load(),
  contextMenu: null,
  confirm: null,
  blocked: null,
  updateReady: false,
  saveFailed: false,
  quickLook: null,
  windowTitle: null,
  tour: null,
  layoutTab: 'page',
  editorSelect: null,
  exportTo: null,
  spreadSelection: [],
});

// One selection at a time: photos on the desk, or spreads in the sidebar.
let selected = { photos: ui.get().selection, spreads: ui.get().spreadSelection };
ui.subscribe(() => {
  const { selection, spreadSelection } = ui.get();
  if (selection !== selected.photos && selection.length && spreadSelection.length) ui.set({ spreadSelection: [] });
  else if (spreadSelection !== selected.spreads && spreadSelection.length && selection.length)
    ui.set({ selection: [] });
  selected = { photos: ui.get().selection, spreads: ui.get().spreadSelection };
});

/**
 * While set, the page and dialog stay as they are: nothing (shortcuts, menus, a new project)
 * can leave or replace them. For work that mustn't be hidden midway, like posting to Instagram.
 */
let pageLock = false;

export function lockPage(locked: boolean): void {
  pageLock = locked;
}

export function pageLocked(): boolean {
  return pageLock;
}

/**
 * Asked before the open dialog closes or is replaced, by whatever does it (its ×, Esc, a page
 * switch, a shortcut, a menu): resolves whether to go on. Layout sets it while page changes
 * wait for Apply.
 */
let closeGuard: (() => Promise<boolean>) | null = null;

export function setCloseGuard(guard: (() => Promise<boolean>) | null): void {
  closeGuard = guard;
}

/** Whether the open dialog (or the window holding it) may close: asks, if it has a guard. */
export function mayClose(): Promise<boolean> {
  return closeGuard ? closeGuard() : Promise.resolve(true);
}

/** Change the page and dialog, once the dialog being closed agrees (and not while locked). */
function change(next: Pick<UiState, 'page' | 'modal'>): void {
  const s = ui.get();
  if (pageLock || (next.page === s.page && next.modal === s.modal)) return;
  if (!closeGuard || next.modal === s.modal) return ui.set(next);
  void closeGuard().then((ok) => {
    if (ok && !pageLock) ui.set(next);
  });
}

/** Go to a page, closing any dialog. */
export function goToPage(page: Page): void {
  change({ page, modal: null });
}

export function openModal(modal: Modal): void {
  change({ page: ui.get().page, modal });
}

export function closeModal(): void {
  change({ page: ui.get().page, modal: null });
}

export function toggleModal(modal: Modal): void {
  change({ page: ui.get().page, modal: ui.get().modal === modal ? null : modal });
}

/** A page's (or dialog's) line in the status bar, while it's open: see `addPageStatus`. */
export interface PageStatus {
  set(text: string | null): void;
  remove(): void;
}

/**
 * What the open pages and dialogs say in the status bar, in the order they opened. The last
 * one's shows; closing it (Layout over Preview, say) brings back the one under it.
 */
const pageStatuses: { text: string | null }[] = [];

function showPageStatus(): void {
  const text = pageStatuses.at(-1)?.text ?? null;
  if (ui.get().pageStatus !== text) ui.set({ pageStatus: text });
}

/** Add a page's (or dialog's) status, shown over any already open until it's removed. */
export function addPageStatus(text: string | null): PageStatus {
  const entry = { text };
  pageStatuses.push(entry);
  showPageStatus();
  return {
    set(next) {
      entry.text = next;
      showPageStatus();
    },
    remove() {
      const i = pageStatuses.indexOf(entry);
      if (i >= 0) pageStatuses.splice(i, 1);
      showPageStatus();
    },
  };
}

/**
 * Whether the desk is out of reach (another page, a dialog, the spread editor, Quick Look,
 * or the tour), pausing desk shortcuts.
 */
export function deskCovered(): boolean {
  const s = ui.get();
  return s.page !== 'desk' || s.modal !== null || s.editingSpreadId !== null || s.quickLook !== null || s.tour !== null;
}

/** Show photos full-size, starting with the first. */
export function openQuickLook(ids: PhotoId[]): void {
  if (ids.length) ui.set({ quickLook: { ids, index: 0 }, contextMenu: null });
}

export function closeQuickLook(): void {
  ui.set({ quickLook: null });
}

/**
 * Ask the user to choose; resolves to the chosen action's value, or null if dismissed.
 * The values are the caller's own literals, so comparing the answer to one it can't be
 * (a typo, say) doesn't compile.
 */
export function ask<const T extends string>(request: {
  title: string;
  message: string;
  actions: readonly ConfirmAction<T>[];
}): Promise<T | null> {
  return new Promise((resolve) => {
    ui.get().confirm?.choose(null);
    ui.set({
      confirm: {
        title: request.title,
        message: request.message,
        actions: request.actions,
        choose: (index) => {
          ui.set({ confirm: null });
          resolve(index === null ? null : (request.actions[index]?.value ?? null));
        },
      },
    });
  });
}

/** Right-click handler for a photo, wherever it's shown. */
export function openPhotoMenu(
  e: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number },
  photoId: PhotoId,
): void {
  e.preventDefault();
  e.stopPropagation();
  ui.set({ contextMenu: { kind: 'photo', x: e.clientX, y: e.clientY, photoId } });
}

/** Told when a setting is saved, to tell the app's other windows (see main.tsx). */
let saved: () => void = () => {};
export function onSettingSaved(tell: () => void): void {
  saved = tell;
}

/** Load the settings again, changed in another window or tab. */
export function reloadSettings(): void {
  const theme = themePref.load();
  const deskColor = deskColorPref.load();
  ui.set({ theme, deskColor, statusBar: statusBarPref.load(), shortcutBadges: shortcutBadgesPref.load() });
  applyTheme(theme);
  applyDeskColor(deskColor);
}

export function setTheme(theme: ThemePref): void {
  ui.set({ theme });
  applyTheme(theme);
  themePref.save(theme);
  saved();
}

export function setDeskColor(color: string): void {
  ui.set({ deskColor: color });
  applyDeskColor(color);
  deskColorPref.save(color);
  saved();
}

/** Set the sidebar width; `persist` saves it (at the end of a resize drag). */
export function setSidebarWidth(width: number, persist: boolean): void {
  ui.set({ sidebarWidth: width });
  if (persist) sidebarWidthPref.save(Math.round(width));
}

export function setStatusBar(shown: boolean): void {
  ui.set({ statusBar: shown });
  statusBarPref.save(shown);
  saved();
}

export function setShortcutBadges(shown: boolean): void {
  ui.set({ shortcutBadges: shown, hints: false });
  shortcutBadgesPref.save(shown);
  saved();
}

export function toggleSidebar(): void {
  const open = !ui.get().sidebarOpen;
  ui.set({ sidebarOpen: open });
  sidebarOpenPref.save(open);
}

export function toggleGuides(): void {
  ui.set((s) => ({ guidesHidden: !s.guidesHidden }));
}

/** Stop showing and saving the project, for this reason (the first one given stands). */
export function block(reason: 'outdated' | 'elsewhere'): void {
  ui.set((s) => ({ blocked: s.blocked ?? reason }));
}
