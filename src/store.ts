import { useSyncExternalStore } from 'react';
import { produce, type Draft } from 'immer';
import { newGuideId, newSpreadId } from './ids';
import { CURRENT_SCHEMA, type Project } from './types';
import { DEFAULT_PAGE } from './units';

const HISTORY_LIMIT = 200;
const COALESCE_MS = 1000;

type Recipe = (d: Draft<Project>) => void;

export interface HistoryState {
  project: Project;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Document store with undo/redo.
 * - `apply` records a discrete change.
 * - `begin` / `preview` / `end` wrap a gesture (like a drag) so it records a single step.
 */
class ProjectStore {
  private past: Project[] = [];
  private future: Project[] = [];
  private present: Project;
  private gestureBase: Project | null = null;
  private lastCoalesce: { key: string; at: number } | null = null;
  private snapshot: HistoryState;
  private listeners = new Set<() => void>();

  constructor(initial: Project) {
    this.present = initial;
    this.snapshot = this.makeSnapshot();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): HistoryState => this.snapshot;

  get project(): Project {
    return this.present;
  }

  /** The project a gesture started from (or the present, outside a gesture). */
  get gestureStart(): Project {
    return this.gestureBase ?? this.present;
  }

  /** Every project still reachable through undo/redo. */
  allProjects(): Project[] {
    return [...this.past, this.present, ...this.future, ...(this.gestureBase ? [this.gestureBase] : [])];
  }

  /**
   * Show `doc` in place of the project for a while (e.g. a demo), with its own history.
   * Returns a function that brings back the project exactly as it was, history included.
   */
  swap(project: Project): () => void {
    this.cancel();
    const { past, future, present } = this;
    this.reset(project);
    return () => {
      this.cancel();
      this.past = past;
      this.future = future;
      this.present = present;
      this.lastCoalesce = null;
      this.emit();
    };
  }

  reset(project: Project): void {
    this.past = [];
    this.future = [];
    this.gestureBase = null;
    this.present = project;
    this.emit();
  }

  apply(recipe: Recipe, opts: { coalesce?: string } = {}): void {
    const next = produce(this.present, recipe);
    if (next === this.present) return;
    const now = Date.now();
    const coalesce =
      opts.coalesce !== undefined &&
      this.lastCoalesce?.key === opts.coalesce &&
      now - this.lastCoalesce.at < COALESCE_MS;
    if (!coalesce) this.push(this.present);
    this.lastCoalesce = opts.coalesce !== undefined ? { key: opts.coalesce, at: now } : null;
    this.future = [];
    this.present = next;
    this.emit();
  }

  /** Replace the whole document as one undoable step (e.g. importing a project). */
  replace(project: Project): void {
    this.push(this.present);
    this.future = [];
    this.lastCoalesce = null;
    this.present = project;
    this.emit();
  }

  /** Change the present without recording history (e.g. raising a clicked photo). */
  silent(recipe: Recipe): void {
    const next = produce(this.present, recipe);
    if (next === this.present) return;
    this.present = next;
    this.emit();
  }

  begin(): void {
    this.gestureBase = this.present;
  }

  /** Replace the gesture's result, starting over from the project as it was at `begin`. */
  preview(recipe: Recipe): void {
    const base = this.gestureBase ?? this.present;
    this.present = produce(base, recipe);
    this.emit();
  }

  end(): void {
    const base = this.gestureBase;
    this.gestureBase = null;
    if (base && base !== this.present) {
      this.push(base);
      this.future = [];
      this.lastCoalesce = null;
    }
    this.emit();
  }

  cancel(): void {
    if (this.gestureBase) this.present = this.gestureBase;
    this.gestureBase = null;
    this.emit();
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.present);
    this.present = prev;
    this.lastCoalesce = null;
    this.emit();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.present);
    this.present = next;
    this.lastCoalesce = null;
    this.emit();
  }

  private push(project: Project): void {
    this.past.push(project);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
  }

  private makeSnapshot(): HistoryState {
    return { project: this.present, canUndo: this.past.length > 0, canRedo: this.future.length > 0 };
  }

  private emit(): void {
    this.snapshot = this.makeSnapshot();
    for (const fn of this.listeners) fn();
  }
}

export function emptyProject(): Project {
  const margin = newGuideId();
  return {
    schemaVersion: CURRENT_SCHEMA,
    photos: {},
    pile: [],
    page: { ...DEFAULT_PAGE },
    layout: {
      kind: 'spreads',
      firstSpread: { kind: 'first', id: newSpreadId(), items: [] },
      spreads: [
        { kind: 'middle', id: newSpreadId(), items: [] },
        { kind: 'middle', id: newSpreadId(), items: [] },
      ],
      lastSpread: { kind: 'last', id: newSpreadId(), items: [] },
    },
    settings: {
      centerV: true,
      centerH: true,
      keepRelative: true,
      borders: [
        { id: margin, kind: 'even', inset: 0.5 },
        { id: newGuideId(), kind: 'even', inset: 1.25 },
      ],
      lines: [],
      dropBorder: margin,
    },
    nextZ: 1,
  };
}

export const projectStore = new ProjectStore(emptyProject());

export function useProject(): HistoryState {
  return useSyncExternalStore(projectStore.subscribe, projectStore.getSnapshot);
}

/** Tiny observable store for UI state that is not part of undo history. */
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };
  return {
    get: () => state,
    subscribe,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      for (const fn of listeners) fn();
    },
    use<U>(select: (s: T) => U): U {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useSyncExternalStore(subscribe, () => select(state));
    },
  };
}
