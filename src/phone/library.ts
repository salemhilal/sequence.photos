import { deleteImage, deleteState, imageIds, loadState, storeState } from '../db';
import { forgetUrl } from '../images';
import { migrateProject } from '../schema';
import { allSpreads } from '../spreads';
import { emptyProject, projectStore } from '../store';
import { ui } from '../ui';
import type { Frame, PageSetup, PhotoMeta, Project } from '../types';
import { newFrame } from './frameActions';

/**
 * The phone's projects. Unlike the web app, which keeps one project, the phone keeps a list
 * of them (Sequences), each saved on its own as it changes. They live in the phone UI's own
 * database (see main.tsx), beside their photos, which projects may share.
 */

/** A project in the list: enough to show it without loading it. */
export interface LibraryEntry {
  id: string;
  name: string;
  /** When it last changed, in ms since the epoch. */
  updated: number;
  page: PageSetup;
  frameCount: number;
  /** Its first few frames, and their photos, for the list's thumbnails. */
  cover: { frames: Frame[]; photos: Record<string, PhotoMeta> };
}

const INDEX_KEY = 'phone:index';
const projectKey = (id: string) => `phone:project:${id}`;
const SAVE_DELAY = 400;
/** How many frames a list row shows. */
const COVER_FRAMES = 3;

/** A new project's name, until it's renamed. */
export const UNTITLED = 'Untitled sequence';

/** Instagram's portrait size: where a new sequence starts. */
export const NEW_PAGE: PageSetup = { w: 1080, h: 1350, unit: 'px', pxPerUnit: 1 };

/** The list's entry for a project, as it is now. */
export function entryFor(id: string, name: string, project: Project, updated: number): LibraryEntry {
  const frames = allSpreads(project) as Frame[];
  const cover = frames.slice(0, COVER_FRAMES);
  const photos: Record<string, PhotoMeta> = {};
  for (const f of cover)
    for (const i of f.items) {
      const p = project.photos[i.photoId];
      if (p) photos[p.id] = p;
    }
  return { id, name, updated, page: project.page, frameCount: frames.length, cover: { frames: cover, photos } };
}

/** The list with `entry` in it (replacing the one with its id), most recently changed first. */
export function withEntry(list: readonly LibraryEntry[], entry: LibraryEntry): LibraryEntry[] {
  return [entry, ...list.filter((e) => e.id !== entry.id)].sort((a, b) => b.updated - a.updated);
}

/** A sequence of one empty frame, at Instagram's portrait size, with a border guide 5% in. */
export function newSequence(page: PageSetup = NEW_PAGE): Project {
  const p = emptyProject();
  const [margin] = p.settings.borders;
  return {
    ...p,
    page: { ...page },
    layout: { kind: 'frames', frames: [newFrame()] },
    settings: {
      ...p.settings,
      borders: margin ? [{ ...margin, kind: 'even', inset: Math.round(page.w * 0.05) }] : [],
      dropBorder: margin?.id ?? null,
    },
  };
}

function isEntry(v: unknown): v is LibraryEntry {
  return typeof v === 'object' && v !== null && typeof (v as LibraryEntry).id === 'string';
}

export async function listProjects(): Promise<LibraryEntry[]> {
  const stored = await loadState(INDEX_KEY);
  return Array.isArray(stored) ? stored.filter(isEntry) : [];
}

async function putEntry(entry: LibraryEntry): Promise<void> {
  await storeState(INDEX_KEY, withEntry(await listProjects(), entry));
}

/** Start a project and list it; resolves to its id. */
export async function createProject(page?: PageSetup): Promise<string> {
  const id = crypto.randomUUID();
  const project = newSequence(page);
  await storeState(projectKey(id), project);
  await putEntry(entryFor(id, UNTITLED, project, Date.now()));
  return id;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const entry = (await listProjects()).find((e) => e.id === id);
  if (entry) await putEntry({ ...entry, name: name.trim() || UNTITLED });
}

export async function deleteProject(id: string): Promise<void> {
  if (open?.id === id) closeProject();
  await deleteState(projectKey(id));
  await storeState(
    INDEX_KEY,
    (await listProjects()).filter((e) => e.id !== id),
  );
  await collectGarbage();
}

/** The project being edited, and how it's saved as it changes. */
let open: { id: string; stop: () => void; flush: () => Promise<void> } | null = null;

/** The open project's id, if any. */
export function openProjectId(): string | null {
  return open?.id ?? null;
}

/**
 * Load a project into the editor (with a fresh undo history), and save it whenever it
 * changes from here on. Resolves once it's loaded.
 */
export async function openProject(id: string): Promise<void> {
  await closeAndSave();
  const stored = await loadState(projectKey(id));
  projectStore.reset(stored ? migrateProject(stored) : newSequence());
  let last = projectStore.project;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = async () => {
    clearTimeout(timer);
    timer = undefined;
    const project = projectStore.project;
    await storeState(projectKey(id), project);
    const name = (await listProjects()).find((e) => e.id === id)?.name ?? UNTITLED;
    await putEntry(entryFor(id, name, project, Date.now()));
  };
  const unsubscribe = projectStore.subscribe(() => {
    if (projectStore.project === last) return;
    last = projectStore.project;
    clearTimeout(timer);
    timer = setTimeout(() => void save(), SAVE_DELAY);
  });
  // Best effort when the app goes to the background, where iOS may end it.
  const hide = () => {
    if (timer !== undefined) void save();
  };
  document.addEventListener('visibilitychange', hide);
  open = {
    id,
    stop: () => {
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener('visibilitychange', hide);
    },
    flush: async () => {
      if (timer !== undefined) await save();
    },
  };
}

/** Stop editing the open project, saving anything not yet saved. */
export async function closeAndSave(): Promise<void> {
  const was = open;
  if (!was) return;
  open = null;
  await was.flush();
  was.stop();
  void collectGarbage();
}

function closeProject(): void {
  open?.stop();
  open = null;
}

/**
 * Delete stored photos no project uses anymore (nor the open one's undo history). Photos
 * being added are stored before any project refers to them, so this waits while they are.
 */
export async function collectGarbage(): Promise<void> {
  const importing = () => ui.get().importing !== null;
  if (importing()) return;
  const live = new Set<string>();
  for (const d of projectStore.allProjects()) for (const id of Object.keys(d.photos)) live.add(id);
  for (const e of await listProjects()) {
    if (e.id === open?.id) continue;
    const stored = await loadState(projectKey(e.id));
    const photos = (stored as { photos?: Record<string, unknown> } | undefined)?.photos;
    if (photos) for (const id of Object.keys(photos)) live.add(id);
  }
  for (const id of await imageIds()) {
    if (importing()) return;
    if (!live.has(id)) {
      await deleteImage(id);
      forgetUrl(id);
    }
  }
}

/** "Edited today", "Edited Oct 12", or with the year if it isn't this one. */
export function editedLabel(updated: number, now = Date.now()): string {
  const d = new Date(updated);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return 'Edited today';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return `Edited ${d.toLocaleDateString('en-US', opts)}`;
}
