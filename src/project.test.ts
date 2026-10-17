// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

// Stand in for IndexedDB: keep stored images in memory, as real Blobs.
vi.mock('./db', () => {
  const images = new Map<string, unknown>();
  return {
    putImage: async (id: string, img: unknown) => void images.set(id, img),
    getImage: async (id: string) => images.get(id),
    deleteImage: async (id: string) => void images.delete(id),
  };
});

import { putOnPage } from './actions';
import { deleteImage, getImage, putImage } from './db';
import { platform } from '#platform';
import { importProject, isProjectFile, newProject, ProjectFileError } from './project';
import { lockModal, ui } from './ui';
import { projectStore, emptyProject } from './store';
import { toPhotoId } from './ids';
import type { Project } from './types';

/** Answer the confirmation showing by clicking the button with this label. */
function pick(label: string): void {
  const c = ui.get().confirm!;
  c.choose(c.actions.findIndex((a) => a.label === label));
}

const A = toPhotoId('a');
const B = toPhotoId('b');
import { createZip } from './zip';
import { allSpreads } from './spreads';

function sampleProject(): Project {
  const project = emptyProject();
  project.photos = {
    [A]: { id: A, name: 'beach.jpg', pxW: 1200, pxH: 900 },
    [B]: { id: B, name: 'beach.jpg', pxW: 900, pxH: 1200 },
  };
  project.pile = [{ photoId: A, x: 1, y: 1, w: 2, h: 1.5, z: 1 }];
  project.nextZ = 2;
  return project;
}

/** Run `fn`, capturing the file it downloads. */
async function captureDownload(fn: () => Promise<unknown>): Promise<{ blob: Blob; name: string }> {
  let blob: Blob | undefined;
  let name = '';
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blob = b as Blob;
    return 'blob:test';
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    name = this.download;
  });
  await fn();
  create.mockRestore();
  click.mockRestore();
  if (!blob) throw new Error('nothing was downloaded');
  return { blob, name };
}

afterEach(() => {
  vi.restoreAllMocks();
  projectStore.reset(emptyProject());
});

describe('project files', () => {
  it('exports and re-imports a project with its layout and images', async () => {
    const project = sampleProject();
    projectStore.reset(project);
    projectStore.apply((d) => putOnPage(d, [B], allSpreads(d)[1]!.id, 'right'));
    const before = projectStore.project;
    await putImage('a', { full: new Blob(['full-a'], { type: 'image/jpeg' }), thumb: new Blob(['thumb-a']) });
    await putImage('b', { full: new Blob(['full-b'], { type: 'image/jpeg' }), thumb: new Blob(['thumb-b']) });

    const { blob, name } = await captureDownload(() => platform.keepProject());
    expect(name).toMatch(/^photo-book-\d{4}-\d{2}-\d{2}\.photo-sequence$/);

    // Simulate opening the file on a fresh machine.
    await deleteImage('a');
    await deleteImage('b');
    projectStore.reset(emptyProject());
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');
    await importProject(new File([blob], name));

    expect(projectStore.project).toEqual(before);
    expect(await (await getImage('b'))!.full.text()).toBe('full-b');
    expect(await (await getImage('a'))!.thumb.text()).toBe('thumb-a');

    projectStore.undo();
    expect(Object.keys(projectStore.project.photos)).toHaveLength(0);
  });

  it('gives duplicate filenames distinct names inside the zip', async () => {
    projectStore.reset(sampleProject());
    await putImage('a', { full: new Blob(['a']), thumb: new Blob(['a']) });
    await putImage('b', { full: new Blob(['b']), thumb: new Blob(['b']) });
    const { blob } = await captureDownload(() => platform.keepProject());
    const { readZip } = await import('./zip');
    const names = [...(await readZip(blob)).keys()].filter((n) => n.startsWith('images/'));
    expect(names.sort()).toEqual(['images/beach (2).jpg', 'images/beach.jpg']);
  });

  it('drops photos whose images are missing from the file', async () => {
    const project = sampleProject();
    const manifest = {
      format: 'photo-sequencer-project',
      version: 1,
      exportedAt: '',
      doc: project,
      files: { a: { image: 'images/a.jpg' }, b: { image: 'images/missing.jpg' } },
    };
    const zip = await createZip([
      { name: 'project.json', data: new Blob([JSON.stringify(manifest)]) },
      { name: 'images/a.jpg', data: new Blob(['a']) },
    ]);
    // With no thumbnail in the file, one is generated from the original.
    const images = await import('./images');
    vi.spyOn(images, 'thumbFromBlob').mockResolvedValue(new Blob(['generated']));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');

    await importProject(new File([zip], 'partial.zip'));
    expect(Object.keys(projectStore.project.photos)).toEqual(['a']);
  });

  it('rejects files that are not projects', async () => {
    const zip = await createZip([{ name: 'notes.txt', data: new Blob(['hi']) }]);
    await expect(importProject(new File([zip], 'notes.zip'))).rejects.toBeInstanceOf(ProjectFileError);
    await expect(importProject(new File(['junk'], 'junk.zip'))).rejects.toBeInstanceOf(ProjectFileError);
  });

  it('refuses projects whose contents are from a newer version', async () => {
    const project = { ...sampleProject(), schemaVersion: 99 };
    const manifest = { format: 'photo-sequencer-project', version: 1, exportedAt: '', doc: project, files: {} };
    const zip = await createZip([{ name: 'project.json', data: new Blob([JSON.stringify(manifest)]) }]);
    await expect(importProject(new File([zip], 'future.photo-sequence'))).rejects.toThrow(/newer version/);
  });

  it('recognizes .photo-sequence files, and still accepts .zip', () => {
    expect(isProjectFile(new File([], 'book.photo-sequence'))).toBe(true);
    expect(isProjectFile(new File([], 'book.zip'))).toBe(true);
    expect(isProjectFile(new File([], 'photo.jpg', { type: 'image/jpeg' }))).toBe(false);
  });

  it('refuses projects from a newer version', async () => {
    const manifest = {
      format: 'photo-sequencer-project',
      version: 99,
      exportedAt: '',
      project: sampleProject(),
      files: {},
    };
    const zip = await createZip([{ name: 'project.json', data: new Blob([JSON.stringify(manifest)]) }]);
    await expect(importProject(new File([zip], 'future.zip'))).rejects.toThrow(/newer version/);
  });

  it('starts a new project only after confirming, and can be undone', async () => {
    projectStore.reset(sampleProject());
    const cancelled = newProject();
    pick('Cancel');
    await cancelled;
    expect(Object.keys(projectStore.project.photos)).toHaveLength(2);

    const confirmed = newProject();
    expect(ui.get().confirm!.actions.map((a) => a.label)).toEqual(['Cancel', 'Save first', 'New project']);
    pick('New project');
    await confirmed;
    expect(Object.keys(projectStore.project.photos)).toHaveLength(0);
    projectStore.undo();
    expect(Object.keys(projectStore.project.photos)).toHaveLength(2);
  });

  it('starts no new project while a dialog is locked open', async () => {
    projectStore.reset(sampleProject());
    ui.set({ modal: 'export' });
    lockModal(true);
    try {
      await newProject();
      expect(ui.get().confirm).toBeNull();
      expect(ui.get().modal).toBe('export');
      expect(Object.keys(projectStore.project.photos)).toHaveLength(2);
    } finally {
      lockModal(false);
      ui.set({ modal: null });
    }
  });
});
