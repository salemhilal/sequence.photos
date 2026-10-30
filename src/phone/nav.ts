import { flushSync } from 'react-dom';
import type { PhotoId, SpreadId } from '../ids';
import { createStore } from '../store';
import { ui } from '../ui';
import { openProject, type LibraryEntry } from './library';

/**
 * Where the phone UI is, and what's open on it: not part of a project or its undo history.
 * Sequences (the list) → a sequence's frames → one frame's editor, with sheets over them.
 */

export type Screen = 'library' | 'frames' | 'editor' | 'preview';

/** A sheet over the screen: where new photos go, the frame size, exporting, or a name. */
export type Sheet = 'add' | 'size' | 'export' | 'rename' | null;

/** What's selected in the editor: nothing (the desk shows), the frame, or a photo on it. */
export type Editing = { kind: 'none' } | { kind: 'frame' } | { kind: 'photo'; id: PhotoId };

export interface PhoneState {
  screen: Screen;
  /** The open sequence's name, as listed. */
  name: string;
  /** The frame in the editor. */
  frameId: SpreadId | null;
  sheet: Sheet;
  /** Photos chosen to add, waiting to be told where. */
  pending: File[];
  /** Choosing frames in the frames grid (for Duplicate and Delete). */
  selecting: boolean;
  selected: SpreadId[];
  editing: Editing;
  /** The photo in crop mode, if any. */
  cropping: PhotoId | null;
  /** Whether the editor shows the guides. */
  guides: boolean;
  /** Whether the editor's tools are open below the frame, or tucked away to show it larger. */
  drawer: boolean;
  /** Where the preview starts (a frame's index), and the screen it goes back to. */
  preview: { from: number; back: Screen };
}

const NONE: Editing = { kind: 'none' };

export const phone = createStore<PhoneState>({
  screen: 'library',
  name: '',
  frameId: null,
  sheet: null,
  pending: [],
  selecting: false,
  selected: [],
  editing: NONE,
  cropping: null,
  guides: true,
  drawer: true,
  preview: { from: 0, back: 'frames' },
});

/**
 * How a change of screen moves: deeper in (push) or back out (pop), to the next or previous
 * frame, up into a preview and back, or a crossfade (into crop mode and out).
 */
export type Motion = 'push' | 'pop' | 'next' | 'prev' | 'up' | 'down' | 'fade';

/**
 * Change screens with a transition (the View Transitions API: WebKit draws the old screen and
 * the new one, and phone.css says how they move). Without it, or with reduced motion, it
 * just changes.
 */
export function navigate(motion: Motion, change: () => void): void {
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof document === 'undefined' || !('startViewTransition' in document) || still) return change();
  const root = document.documentElement;
  root.dataset.motion = motion;
  const t = document.startViewTransition(() => flushSync(change));
  // A transition cut short (the app hidden, another one starting) is no problem: the change
  // itself has still happened.
  const done = () => {
    if (root.dataset.motion === motion) delete root.dataset.motion;
  };
  t.ready.catch(() => {});
  t.finished.then(done, done);
}

/** Open a frame in the editor, with nothing selected (from the grid, or another frame). */
export function openEditor(frameId: SpreadId, motion: Motion = 'push'): void {
  navigate(motion, () =>
    phone.set({ screen: 'editor', frameId, editing: NONE, cropping: null, selecting: false, selected: [] }),
  );
}

/** Back to the frames grid. */
export function showFrames(): void {
  navigate('pop', () => phone.set({ screen: 'frames', editing: NONE, cropping: null }));
}

/** Show every frame, one at a time and full size, from the frame at `from`. */
export function showPreview(from = 0): void {
  const back = phone.get().screen;
  navigate('up', () => phone.set({ screen: 'preview', preview: { from, back }, sheet: null }));
}

/** Leave the preview, back where it was opened. */
export function closePreview(): void {
  navigate('down', () => phone.set({ screen: phone.get().preview.back }));
}

/** `selected` with `id` added, or taken out if it was there. */
export function toggled(selected: readonly SpreadId[], id: SpreadId): SpreadId[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

/**
 * Where a frame dragged in the grid lands: before the cell whose middle is past the finger,
 * reading across rows. `cells` are the cells' boxes, in order; returns an index from 0 to
 * their count.
 */
export function dropIndex(
  cells: readonly { left: number; top: number; width: number; height: number }[],
  x: number,
  y: number,
): number {
  for (const [i, c] of cells.entries()) {
    const row = y < c.top + c.height;
    if (y < c.top) return i;
    if (row && x < c.left + c.width / 2) return i;
  }
  return cells.length;
}

/** Open a sequence from the list: load it, and show its frames. */
export async function openSequence(entry: Pick<LibraryEntry, 'id' | 'name'>): Promise<void> {
  try {
    await openProject(entry.id);
  } catch (e) {
    ui.set({ notice: `Couldn’t open “${entry.name}”: ${e instanceof Error ? e.message : String(e)}` });
    return;
  }
  navigate('push', () =>
    phone.set({ screen: 'frames', name: entry.name, selecting: false, selected: [], sheet: null }),
  );
}
