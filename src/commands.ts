import type { PhotoId } from './ids';
import { useEffect } from 'react';
import type { Platform } from './platform/types';
import { deleteFromProject, importPhotos } from './actions';
import { exportIndesign } from './indesign';
import { copyPhotos, duplicateAndSelect } from './clipboard';
import { savePdf } from './pdf';
import { exportFrames } from './frames';
import { instagramConnection } from './instagram';
import { hasMod, isMac, isTextField, isTyping, MOD_LABEL } from './input';
import { platform } from '#platform';
import { pickFiles } from './files';
import { newProject } from './project';
import { projectStore } from './store';
import { startTour } from './tour';
import { deskCovered, openModal, toggleGuides, toggleModal, toggleSidebar, ui } from './ui';

/**
 * Every command in one table. Each has its name, bindings, when it applies, and what
 * it does; the key handler, the hold-⌘ hints, and both menus (the website's File menu,
 * the Mac app's menu bar) read from here, so adding a command is one entry.
 *
 * (The spread editor, preview, and open menus handle their own keys while they're open.)
 */

interface Binding {
  /** `KeyboardEvent.key`, lowercased. */
  key: string;
  /** Requires the platform modifier (⌘ on macOS, Ctrl elsewhere). */
  mod?: boolean;
  /** `true` requires Shift, `false` (default) forbids it, `'any'` allows either. */
  shift?: boolean | 'any';
}

interface Command {
  bindings: Binding[];
  /**
   * Where it applies: `app` works anywhere (even over dialogs); `desk` only when no
   * dialog or spread editor covers the desk.
   */
  scope: 'app' | 'desk';
  /** Whether it also fires while typing in a text field (off by default). */
  inFields?: boolean;
  /**
   * `e` is the key event when run from a shortcut (absent from menus). Return false
   * to leave the key alone (e.g. nothing selected).
   */
  run: (e?: KeyboardEvent) => void | false;
  /** Overrides the label derived from the first binding. */
  label?: string;
  /**
   * Its name in menus, in sentence case (the Mac app's menu bar title-cases it). Give
   * both where the website and the app word it differently.
   */
  title?: string | Record<Platform['kind'], string>;
}

export function addPhotos(): void {
  if (ui.get().importing) return;
  pickFiles('image/*', true, (files) => void importPhotos(files));
}

const NUDGE = 1 / 8;
const NUDGE_BIG = 1;

function nudgeSelection(e?: KeyboardEvent): void | false {
  const ids = new Set(ui.get().selection);
  if (!e || !ids.size) return false;
  const n = e.shiftKey ? NUDGE_BIG : NUDGE;
  const dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0;
  const dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0;
  projectStore.apply(
    (d) => {
      for (const p of d.pile) {
        if (!ids.has(p.photoId)) continue;
        p.x += dx;
        p.y += dy;
      }
    },
    { coalesce: 'desk-nudge' },
  );
}

/** Runs `fn` with the desk selection, or leaves the key alone when nothing is selected. */
const withSelection = (fn: (ids: PhotoId[]) => void) => (): void | false => {
  const ids = ui.get().selection;
  if (!ids.length) return false;
  fn(ids);
};

export const commands = {
  // No shortcut: browsers reserve ⌘N / Ctrl+N for a new window.
  newProject: { title: 'New project…', bindings: [], scope: 'app', run: () => void newProject() },
  addPhotos: {
    title: 'Add photos…',
    bindings: [{ key: 'i', mod: true }],
    scope: 'app',
    inFields: true,
    run: addPhotos,
  },
  importProject: {
    title: { browser: 'Import project…', macos: 'Open…' },
    bindings: [{ key: 'o', mod: true }],
    scope: 'app',
    inFields: true,
    run: () => platform.openProject(),
  },
  exportProject: {
    title: { browser: 'Export project', macos: 'Save' },
    bindings: [{ key: 's', mod: true }],
    scope: 'app',
    inFields: true,
    run: () => void platform.keepProject(),
  },
  // Only where there are project files to save to (the Mac app).
  saveAs: {
    title: 'Save as…',
    bindings: platform.keepProjectAs ? [{ key: 's', mod: true, shift: true }] : [],
    scope: 'app',
    inFields: true,
    run: () => void platform.keepProjectAs?.(),
  },
  savePdf: {
    // The Mac app asks where to save it first.
    title: { browser: 'Save PDF', macos: 'Save PDF…' },
    bindings: [{ key: 'p', mod: true, shift: true }],
    scope: 'app',
    inFields: true,
    run: () => void savePdf(),
  },
  // InDesign for print books; images for digital sequences.
  exportIndesign: {
    title: { browser: 'Export for InDesign', macos: 'Export for InDesign…' },
    bindings: [],
    scope: 'app',
    run: () => (projectStore.project.layout.kind === 'print' ? void exportIndesign() : false),
  },
  exportFrames: {
    title: { browser: 'Export frames as images', macos: 'Export Frames as Images…' },
    bindings: [{ key: 'e', mod: true, shift: true }],
    scope: 'app',
    inFields: true,
    run: () => (projectStore.project.layout.kind === 'digital' ? void exportFrames() : false),
  },
  // Digital sequences, with an Instagram account connected (Settings), on the web.
  postToInstagram: {
    title: 'Post to Instagram…',
    bindings: [],
    scope: 'app',
    run: () => {
      const connection = instagramConnection();
      const ready = projectStore.project.layout.kind === 'digital' && connection && !connection.needsReconnect;
      return ready ? openModal('instagram') : false;
    },
  },
  preview: {
    // The toolbar says "Preview book" for a book; menus just "Preview".
    title: 'Preview',
    bindings: [{ key: 'p', mod: true }],
    scope: 'app',
    inFields: true,
    run: () => toggleModal('preview'),
  },
  layout: {
    title: { browser: 'Layout', macos: 'Layout…' },
    bindings: [],
    scope: 'app',
    run: () => toggleModal('layout'),
  },
  // ⌘; as in InDesign and Photoshop.
  toggleGuides: { bindings: [{ key: ';', mod: true }], scope: 'app', inFields: true, run: toggleGuides },
  settings: {
    title: 'Settings…',
    bindings: [{ key: ',', mod: true }],
    scope: 'app',
    inFields: true,
    run: () => toggleModal('settings'),
  },
  toggleSidebar: { bindings: [{ key: 'b', mod: true }], scope: 'app', inFields: true, run: toggleSidebar },
  undo: { title: 'Undo', bindings: [{ key: 'z', mod: true }], scope: 'app', run: () => projectStore.undo() },
  redo: {
    title: 'Redo',
    bindings: [
      { key: 'z', mod: true, shift: true },
      { key: 'y', mod: true },
    ],
    scope: 'app',
    label: isMac ? '⇧⌘Z' : 'Ctrl+Y',
    run: () => projectStore.redo(),
  },
  selectAll: {
    title: 'Select all',
    bindings: [{ key: 'a', mod: true }],
    scope: 'desk',
    run: () => ui.set({ selection: projectStore.project.pile.map((p) => p.photoId) }),
  },
  copy: {
    bindings: [{ key: 'c', mod: true }],
    scope: 'desk',
    // A failed system-clipboard write still leaves the photos pasteable inside the app.
    run: withSelection((ids) => void copyPhotos(ids).catch(() => {})),
  },
  duplicate: {
    title: 'Duplicate',
    bindings: [{ key: 'd', mod: true }],
    scope: 'desk',
    run: withSelection((ids) => void duplicateAndSelect(ids)),
  },
  deleteSelection: {
    title: 'Delete',
    bindings: [{ key: 'delete' }, { key: 'backspace' }],
    scope: 'desk',
    run: withSelection((ids) => deleteFromProject(ids)),
  },
  clearSelection: { bindings: [{ key: 'escape' }], scope: 'desk', run: () => ui.set({ selection: [] }) },
  nudge: {
    bindings: ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].map((key) => ({ key, shift: 'any' as const })),
    scope: 'desk',
    run: nudgeSelection,
  },
  about: {
    title: { browser: 'About…', macos: 'About Sequence' },
    bindings: [],
    scope: 'app',
    run: () => openModal('about'),
  },
  tour: { title: 'Take the tour', bindings: [], scope: 'app', run: startTour },
} satisfies Record<string, Command>;

export type CommandId = keyof typeof commands;

/** A command's name for menus on this platform (sentence case). */
export function commandTitle(id: CommandId): string {
  const t = (commands[id] as Command).title ?? id;
  return typeof t === 'string' ? t : t[platform.kind];
}

/** Run a command from a menu or button. */
export function runCommand(id: CommandId): void {
  (commands[id] as Command).run();
}

/**
 * Run a command chosen from the Mac app's menu bar. Shortcuts reach the page first, so
 * this runs for clicks, and for shortcuts the page left alone: those typed in a text
 * field, which get the field's own editing (e.g. its undo) instead. Returns whether it ran.
 */
export function runFromMenu(id: CommandId, textFallback?: () => void): boolean {
  const c: Command = commands[id];
  if (isTextField(document.activeElement) && !c.inFields) {
    textFallback?.();
    return false;
  }
  if (c.scope === 'desk' && deskCovered()) return false;
  c.run();
  return true;
}

/** The shortcut as a native menu accelerator, e.g. "CmdOrCtrl+Shift+P"; none for plain keys like Delete. */
export function shortcutAccelerator(id: CommandId): string | undefined {
  const b = (commands[id] as Command).bindings[0];
  // Menus would take plain keys (Delete, Escape, arrows) away from text fields.
  if (!b?.mod) return undefined;
  return ['CmdOrCtrl', b.shift === true && 'Shift', b.key.length === 1 ? b.key.toUpperCase() : b.key]
    .filter(Boolean)
    .join('+');
}

function matches(b: Binding, e: KeyboardEvent): boolean {
  if (e.key.toLowerCase() !== b.key || e.altKey) return false;
  if (hasMod(e) !== Boolean(b.mod)) return false;
  return b.shift === 'any' || e.shiftKey === Boolean(b.shift);
}

/** The shortcut's label for display, e.g. "⌘O" or "Ctrl+Shift+P"; empty if it has none. */
export function shortcutLabel(id: CommandId): string {
  const c: Command = commands[id];
  if (c.label) return c.label;
  const b = c.bindings[0];
  if (!b) return '';
  const key = b.key.length === 1 ? b.key.toUpperCase() : b.key;
  if (!b.mod) return key;
  if (isMac) return `${b.shift === true ? '⇧' : ''}⌘${key}`;
  return `${MOD_LABEL}${b.shift === true ? 'Shift+' : ''}${key}`;
}

/** How long the modifier must be held before shortcut hints appear. */
const HINT_DELAY = 250;

/** Handles every command's shortcut, and shows hints while the modifier is held. */
export function useCommandShortcuts(): void {
  useEffect(() => {
    const modKey = isMac ? 'Meta' : 'Control';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hideHints = () => {
      clearTimeout(timer);
      if (ui.get().hints) ui.set({ hints: false });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === modKey) {
        if (!e.repeat) {
          clearTimeout(timer);
          timer = setTimeout(() => ui.set({ hints: true }), HINT_DELAY);
        }
        return;
      }
      hideHints();
      if (e.defaultPrevented) return;
      for (const c of Object.values(commands) as Command[]) {
        if (!c.bindings.some((b) => matches(b, e))) continue;
        if (isTyping(e) && !c.inFields) return;
        if (c.scope === 'desk' && deskCovered()) return;
        if (c.run(e) !== false) e.preventDefault();
        return;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === modKey) hideHints();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', hideHints);
    return () => {
      hideHints();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', hideHints);
    };
  }, []);
}
