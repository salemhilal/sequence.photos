import type { PhotoId, SpreadId } from '../ids';
import { createStore } from '../store';
import { ui } from '../ui';
import { openProject, type LibraryEntry } from './library';

/**
 * Where the phone UI is, and what's open on it: not part of a project or its undo history.
 * Sequences (the list) → a sequence's frames → one frame's editor, with sheets over them.
 */

export type Screen = 'library' | 'frames' | 'editor';

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
});

/** Open a frame in the editor, with nothing selected. */
export function openEditor(frameId: SpreadId): void {
  phone.set({ screen: 'editor', frameId, editing: NONE, cropping: null, selecting: false, selected: [] });
}

/** Back to the frames grid. */
export function showFrames(): void {
  phone.set({ screen: 'frames', editing: NONE, cropping: null });
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
  phone.set({ screen: 'frames', name: entry.name, selecting: false, selected: [], sheet: null });
}
