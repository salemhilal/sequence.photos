import { applyDeskColor } from './deskColor';
import type { DropTarget } from './drag';
import type { PhotoId, SpreadId } from './ids';
import { deskColorPref, sidebarOpenPref, sidebarWidthPref, themePref } from './prefs';
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

export type Modal = 'settings' | 'about' | 'preview' | 'layout' | 'instagram';

export interface UiState {
  selection: PhotoId[];
  editingSpreadId: SpreadId | null;
  /** The open full-window dialog, if any. (The spread editor is tracked by editingSpreadId.) */
  modal: Modal | null;
  view: DeskView;
  ghost: Ghost | null;
  /** The drop target under the pointer during a drag, for highlighting (compare with `sameTarget`). */
  hover: DropTarget;
  importing: { done: number; total: number } | null;
  /** Status text for long-running work like exporting. */
  busy: string | null;
  notice: string | null;
  /** True while the shortcut modifier is held, to reveal shortcut hints. */
  hints: boolean;
  theme: ThemePref;
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
}

export const ui = createStore<UiState>({
  selection: [],
  editingSpreadId: null,
  modal: null,
  view: { panX: 40, panY: 40, zoom: 1 },
  ghost: null,
  hover: null,
  importing: null,
  busy: null,
  notice: null,
  hints: false,
  theme: themePref.load(),
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
});

export function openModal(modal: Modal): void {
  ui.set({ modal });
}

export function closeModal(): void {
  ui.set({ modal: null });
}

export function toggleModal(modal: Modal): void {
  ui.set((s) => ({ modal: s.modal === modal ? null : modal }));
}

/** Whether something covers the desk (a dialog, the spread editor, Quick Look, or the tour), pausing desk shortcuts. */
export function deskCovered(): boolean {
  const s = ui.get();
  return s.modal !== null || s.editingSpreadId !== null || s.quickLook !== null || s.tour !== null;
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

export function setTheme(theme: ThemePref): void {
  ui.set({ theme });
  applyTheme(theme);
  themePref.save(theme);
}

export function setDeskColor(color: string): void {
  ui.set({ deskColor: color });
  applyDeskColor(color);
  deskColorPref.save(color);
}

/** Set the sidebar width; `persist` saves it (at the end of a resize drag). */
export function setSidebarWidth(width: number, persist: boolean): void {
  ui.set({ sidebarWidth: width });
  if (persist) sidebarWidthPref.save(Math.round(width));
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
