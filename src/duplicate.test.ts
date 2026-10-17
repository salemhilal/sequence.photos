import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toPhotoId } from './ids';
import { allSpreads } from './spreads';

const A = toPhotoId('a');
const B = toPhotoId('b');

// Stand in for IndexedDB: keep stored images in memory.
const images = new Map<string, unknown>();
vi.mock('./db', () => ({
  putImage: async (id: string, img: unknown) => void images.set(id, img),
  getImage: async (id: string) => images.get(id),
  deleteImage: async (id: string) => void images.delete(id),
}));

const { addPhotosToPile, copyName, duplicatePhotos, putOnPage } = await import('./actions');
const { projectStore, emptyProject } = await import('./store');
const { applyPageSetup, draftOf } = await import('./pageSetup');
const { sheetOf } = await import('./spreads');

beforeEach(() => {
  images.clear();
  projectStore.reset(emptyProject());
  addPhotosToPile([{ id: A, name: 'IMG_1.jpg', pxW: 1200, pxH: 800 }]);
  images.set(A, { full: new Blob(['full']), thumb: new Blob(['thumb']) });
});

describe('duplicatePhoto', () => {
  it('names copies', () => {
    expect(copyName('IMG_1.jpg')).toBe('IMG_1 copy.jpg');
    expect(copyName('scan')).toBe('scan copy');
  });

  it('adds an independent copy next to a desk photo, with its own image data', async () => {
    const [id] = await duplicatePhotos([A]);
    const project = projectStore.project;
    expect(id).not.toBe(A);
    expect(project.photos[id!]).toMatchObject({ name: 'IMG_1 copy.jpg', pxW: 1200, pxH: 800 });
    const [orig, copy] = [A, id!].map((pid) => project.pile.find((p) => p.photoId === pid)!);
    // In proportion to the photo: 0.25 in for a 2 in photo.
    expect(copy!.x - orig!.x).toBeCloseTo((0.25 * Math.max(orig!.w, orig!.h)) / 2);
    expect(copy!.w).toBe(orig!.w);
    expect(copy!.z).toBeGreaterThan(orig!.z);
    expect(images.has(id!)).toBe(true);
  });

  it('keeps the copy on the same spread when the original is on a page', async () => {
    projectStore.apply((d) => putOnPage(d, [A], allSpreads(d)[1]!.id, 'right'));
    const [id] = await duplicatePhotos([A]);
    const items = allSpreads(projectStore.project)[1]!.items.map((i) => i.photoId);
    expect(items).toEqual([A, id]);
    expect(projectStore.project.pile).toHaveLength(0);
  });

  it('offsets a copy on a spread by the same inches as on the desk', async () => {
    projectStore.apply((d) => putOnPage(d, [A], allSpreads(d)[1]!.id, 'right'));
    const [id] = await duplicatePhotos([A]);
    const [orig, copy] = [A, id!].map((pid) =>
      allSpreads(projectStore.project)[1]!.items.find((p) => p.photoId === pid)!,
    );
    expect(copy!.x - orig!.x).toBeCloseTo(0.25);
    expect(copy!.y - orig!.y).toBeCloseTo(0.25);
  });

  it('offsets a copy in a frame by the same share of its width as on a 10 in page', async () => {
    applyPageSetup({
      ...draftOf(projectStore.project),
      arrangement: 'frames',
      page: { w: 1080, h: 1350, unit: 'px', pxPerUnit: 1 },
    });
    expect(sheetOf(projectStore.project).pageW).toBe(1080);
    projectStore.apply((d) => putOnPage(d, [A], allSpreads(d)[0]!.id, 'whole'));
    const [id] = await duplicatePhotos([A]);
    const [orig, copy] = [A, id!].map((pid) =>
      allSpreads(projectStore.project)[0]!.items.find((p) => p.photoId === pid)!,
    );
    expect(copy!.x - orig!.x).toBeCloseTo(27);
    expect(copy!.y - orig!.y).toBeCloseTo(27);
  });

  it('offsets a copy on the desk in proportion to the photo, even in a sequence', async () => {
    applyPageSetup({
      ...draftOf(projectStore.project),
      arrangement: 'frames',
      page: { w: 1080, h: 1350, unit: 'px', pxPerUnit: 1 },
    });
    const [id] = await duplicatePhotos([A], 0.5);
    const [orig, copy] = [A, id!].map((pid) => projectStore.project.pile.find((p) => p.photoId === pid)!);
    const step = (0.5 * Math.max(orig!.w, orig!.h)) / 2;
    expect(copy!.x - orig!.x).toBeCloseTo(step);
    expect(copy!.y - orig!.y).toBeCloseTo(step);
  });

  it('duplicates several photos as one undo step, at a chosen offset', async () => {
    addPhotosToPile([{ id: B, name: 'IMG_2.jpg', pxW: 800, pxH: 800 }]);
    images.set(B, { full: new Blob([B]), thumb: new Blob([B]) });
    const ids = await duplicatePhotos([A, B], 0.5);
    expect(ids).toHaveLength(2);
    const b = projectStore.project.pile.find((p) => p.photoId === B)!;
    const bCopy = projectStore.project.pile.find((p) => p.photoId === ids[1])!;
    expect(bCopy.y - b.y).toBeCloseTo((0.5 * Math.max(b.w, b.h)) / 2);
    projectStore.undo();
    expect(Object.keys(projectStore.project.photos).sort()).toEqual([A, B]);
  });

  it('is undoable', async () => {
    await duplicatePhotos([A]);
    projectStore.undo();
    expect(Object.keys(projectStore.project.photos)).toEqual([A]);
  });
});
