import type { Project } from './types';

// Named for the app's old name (Photobook Sequencer), as are the `photobook-*` prefs: renaming
// them would lose everyone's saved work.
let dbName = 'photobook';
const DB_VERSION = 1;
const STATE = 'state';
const IMAGES = 'images';
// Saved under 'doc', the project's name in the code when this was written; a new key
// would lose everyone's saved work.
const PROJECT_KEY = 'doc';

export interface StoredImage {
  /** The original file, kept for future export. */
  full: Blob;
  /** Downscaled JPEG used for display. */
  thumb: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Keep everything in a database of this name instead, before anything is stored: the phone UI
 * keeps its own (see src/phone/library.ts), so the web app's cleanup never sees its photos.
 */
export function setDatabaseName(name: string): void {
  if (dbPromise) throw new Error('The database is already open');
  dbName = name;
}

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STATE)) db.createObjectStore(STATE);
      if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'));
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

async function store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

/** The saved project as stored; it may be from an older (or newer) version, so run it through migrateProject. */
export async function loadSavedProject(): Promise<unknown> {
  return wrap((await store(STATE, 'readonly')).get(PROJECT_KEY) as IDBRequest<unknown>);
}

export async function storeProject(project: Project): Promise<void> {
  await wrap((await store(STATE, 'readwrite')).put(project, PROJECT_KEY));
}

/** Something else kept beside the project, by key (the phone UI's projects and their list). */
export async function loadState(key: string): Promise<unknown> {
  return wrap((await store(STATE, 'readonly')).get(key) as IDBRequest<unknown>);
}

export async function storeState(key: string, value: unknown): Promise<void> {
  await wrap((await store(STATE, 'readwrite')).put(value, key));
}

export async function deleteState(key: string): Promise<void> {
  await wrap((await store(STATE, 'readwrite')).delete(key));
}

export async function putImage(id: string, img: StoredImage): Promise<void> {
  await wrap((await store(IMAGES, 'readwrite')).put(img, id));
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  return wrap((await store(IMAGES, 'readonly')).get(id) as IDBRequest<StoredImage | undefined>);
}

export async function imageIds(): Promise<string[]> {
  const keys = await wrap((await store(IMAGES, 'readonly')).getAllKeys());
  return keys.filter((k): k is string => typeof k === 'string');
}

export async function deleteImage(id: string): Promise<void> {
  await wrap((await store(IMAGES, 'readwrite')).delete(id));
}
