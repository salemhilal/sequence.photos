import { getImage, putImage } from './db';
import { toPhotoId, type PhotoId } from './ids';
import { allSpreads } from './spreads';
import { setUrl, thumbFromBlob } from './images';
import { migrateProject, NewerProjectError } from './schema';
import { InvalidProjectError } from './validate';
import { isRecord } from './guards';
import { projectStore, emptyProject } from './store';
import { MOD_LABEL } from './input';
import { ask, modalLocked, ui } from './ui';
import { createZip, readZip, type ZipInput } from './zip';
import { platform } from '#platform';

/**
 * Project files are ZIP archives:
 *   project.json      — the document (layout, settings) plus where each photo's files live
 *   images/<name>     — original files, as imported
 *   thumbs/<id>.jpg   — display copies (optional; regenerated on import if missing)
 */
// From the app's old name (Photobook Sequencer); project files carry it, so it stays.
const FORMAT = 'photo-sequencer-project';
const VERSION = 1;
const MANIFEST = 'project.json';

interface Manifest {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  /**
   * The project as saved, in whatever version: `migrateProject` upgrades and checks it.
   * Called `doc` (from before), since files carry the name.
   */
  doc: unknown;
  files: Record<PhotoId, { image: string; thumb?: string }>;
}

export class ProjectFileError extends Error {}

/** The project as a .photo-sequence file (a ZIP), reporting progress in the UI. */
export async function buildProjectFile(verb = 'Exporting'): Promise<Blob> {
  const project = projectStore.project;
  const ids = Object.keys(project.photos).map(toPhotoId);
  const entries: ZipInput[] = [];
  const files: Manifest['files'] = {};
  const usedNames = new Set<string>();

  const setBusy = (busy: string | null) => ui.set({ busy });
  try {
    setBusy(`${verb}…`);
    for (const id of ids) {
      const img = await getImage(id);
      const meta = project.photos[id];
      if (!img || !meta) continue;
      const image = `images/${uniqueName(meta.name, id, usedNames)}`;
      const thumb = `thumbs/${id}.jpg`;
      entries.push({ name: image, data: img.full }, { name: thumb, data: img.thumb });
      files[id] = { image, thumb };
    }
    const manifest: Manifest = {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      doc: project,
      files,
    };
    entries.unshift({
      name: MANIFEST,
      data: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
    });

    const photoCount = Object.keys(files).length;
    const zip = await createZip(entries, (done) =>
      setBusy(`${verb} ${Math.min(photoCount, Math.floor(done / 2))} of ${photoCount}…`),
    );
    // A .photo-sequence file is a ZIP; the octet-stream type keeps browsers from renaming it to .zip.
    return new Blob([zip], { type: 'application/octet-stream' });
  } finally {
    setBusy(null);
  }
}

/** Replace the current project with one from a file. Undoable. */
export async function importProject(file: File): Promise<void> {
  if (ui.get().importing) return;
  ui.set({ busy: 'Opening project…', importing: { done: 0, total: 0 } });
  try {
    const zip = await readZip(file).catch(() => {
      throw new ProjectFileError(`“${file.name}” isn't a Sequence project.`);
    });
    const manifestEntry = zip.get(MANIFEST);
    if (!manifestEntry) throw new ProjectFileError(`“${file.name}” isn't a Sequence project.`);
    const manifest = parseManifest(await (await manifestEntry.blob()).text());
    const newer = new ProjectFileError(
      'This project was made by a newer version of Sequence. Reload to update, then try again.',
    );
    // `version` is the file's layout; the project inside has its own schema version.
    if (manifest.version > VERSION) throw newer;
    let project;
    try {
      project = migrateProject(manifest.doc);
    } catch (e) {
      if (e instanceof NewerProjectError) throw newer;
      if (e instanceof InvalidProjectError) throw new ProjectFileError('The project file is damaged.');
      throw e;
    }
    const ids = Object.keys(project.photos).map(toPhotoId);
    const missing = new Set<PhotoId>();
    let done = 0;
    ui.set({ importing: { done, total: ids.length } });

    for (const id of ids) {
      const paths = manifest.files[id];
      const imageEntry = paths && zip.get(paths.image);
      if (!paths || !imageEntry) {
        missing.add(id);
        continue;
      }
      const full = await imageEntry.blob(mimeFor(paths.image));
      const thumbEntry = paths.thumb ? zip.get(paths.thumb) : undefined;
      const thumb = thumbEntry ? await thumbEntry.blob('image/jpeg') : await thumbFromBlob(full);
      await putImage(id, { full, thumb });
      setUrl(id, thumb);
      ui.set({ importing: { done: ++done, total: ids.length } });
    }

    for (const id of missing) {
      delete project.photos[id];
      project.pile = project.pile.filter((p) => p.photoId !== id);
      for (const s of allSpreads(project)) s.items = s.items.filter((p) => p.photoId !== id);
    }

    projectStore.replace(project);
    ui.set({
      selection: [],
      editingSpreadId: null,
      notice:
        `Opened “${file.name}” · ${ids.length - missing.size} photos. Undo to go back.` +
        (missing.size ? ` ${missing.size} photo${missing.size > 1 ? 's were' : ' was'} missing from the file.` : ''),
    });
  } finally {
    ui.set({ busy: null, importing: null });
  }
}

/** Project files are saved as .photo-sequence (a ZIP inside); plain .zip files are accepted too. */
export const PROJECT_EXTENSION = '.photo-sequence';
export const PROJECT_ACCEPT = `${PROJECT_EXTENSION},.zip,application/zip`;

export function isProjectFile(file: File): boolean {
  return (
    /\.(photo-sequence|zip)$/i.test(file.name) ||
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed'
  );
}

function parseManifest(text: string): Manifest {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    throw new ProjectFileError('The project file is damaged.');
  }
  if (!isRecord(m) || m.format !== FORMAT || typeof m.version !== 'number' || !isRecord(m.files)) {
    throw new ProjectFileError("This file isn't a Sequence project.");
  }
  const files: Manifest['files'] = {};
  for (const [id, f] of Object.entries(m.files)) {
    if (!isRecord(f) || typeof f.image !== 'string' || (f.thumb !== undefined && typeof f.thumb !== 'string')) {
      throw new ProjectFileError('The project file is damaged.');
    }
    files[toPhotoId(id)] = { image: f.image, ...(typeof f.thumb === 'string' && { thumb: f.thumb }) };
  }
  // The project inside is checked, all of it, once it's upgraded (see migrateProject).
  return { format: FORMAT, version: m.version, exportedAt: String(m.exportedAt ?? ''), doc: m.doc, files };
}

/** A filename not yet in `used` (case-insensitively), made safe for any file system. */
export function uniqueName(name: string, id: string, used: Set<string>): string {
  const clean = name.replace(/[/\\:*?"<>|]/g, '_') || `${id}.jpg`;
  let result = clean;
  for (let n = 2; used.has(result.toLowerCase()); n++) {
    const dot = clean.lastIndexOf('.');
    result = dot > 0 ? `${clean.slice(0, dot)} (${n})${clean.slice(dot)}` : `${clean} (${n})`;
  }
  used.add(result.toLowerCase());
  return result;
}

function mimeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const types: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    heic: 'image/heic',
  };
  return types[ext] ?? '';
}

/**
 * Before replacing the current project, confirm (offering to keep a copy first).
 * Resolves to whether to go ahead. `what` finishes "…will replace the project you're working on".
 */
export async function confirmReplace(title: string, what: string, confirmLabel: string): Promise<boolean> {
  if (platform.projectIsSafe()) return true;
  const app = platform.kind === 'macos';
  const photoCount = Object.keys(projectStore.project.photos).length;
  const choice = await ask({
    title,
    message:
      `${what} will replace the project you're working on` +
      (photoCount ? ` (${photoCount} photo${photoCount === 1 ? '' : 's'}). ` : '. ') +
      (app
        ? 'Changes that aren’t saved to its file will be lost. To keep them, save first.'
        : `You can bring it back with ${MOD_LABEL}Z, but not after you reload or close the page. ` +
          'To keep a copy, export it first.'),
    actions: [
      { label: 'Cancel', value: 'cancel' },
      ...(photoCount ? [{ label: app ? 'Save first' : 'Export current first', value: 'export' as const }] : []),
      { label: confirmLabel, value: 'replace', primary: true },
    ],
  });
  if (choice === 'export') return platform.keepProject();
  return choice === 'replace';
}

export async function openProjectFile(file: File): Promise<void> {
  if (modalLocked()) return;
  const hasWork = Object.keys(projectStore.project.photos).length > 0;
  if (hasWork && !(await confirmReplace('Replace your current project?', `“${file.name}”`, 'Replace'))) return;
  try {
    await importProject(file);
    // Dropped or picked in the page, it has no place on disk to save back to.
    platform.projectReplaced();
  } catch (e) {
    ui.set({ notice: e instanceof ProjectFileError ? e.message : `Couldn't open “${file.name}”.` });
  }
}

/** Start over with an empty project, after confirming. Undoable on the website. */
export async function newProject(): Promise<void> {
  // Not while a dialog's work mustn't be interrupted (see lockModal).
  if (modalLocked()) return;
  if (!(await confirmReplace('Start a new project?', 'A new, empty project', 'New project'))) return;
  projectStore.replace(emptyProject());
  ui.set({ selection: [], editingSpreadId: null, modal: null });
  platform.projectReplaced();
}
