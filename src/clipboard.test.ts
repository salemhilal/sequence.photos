import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toPhotoId } from './ids';

const A = toPhotoId('a');
const B = toPhotoId('b');

const images = new Map<string, unknown>();
vi.mock('./db', () => ({
  putImage: async (id: string, img: unknown) => void images.set(id, img),
  getImage: async (id: string) => images.get(id),
  deleteImage: async (id: string) => void images.delete(id),
}));
vi.mock('./images', async (orig) => ({
  ...(await orig<typeof import('./images')>()),
  photoAsPng: async () => new Blob(['png'], { type: 'image/png' }),
}));

// A fake system clipboard that records what was written.
let written: Record<string, Blob> = {};
let failWrites = false;
class FakeClipboardItem {
  items: Record<string, Blob | Promise<Blob>>;
  constructor(items: Record<string, Blob | Promise<Blob>>) {
    this.items = items;
  }
}
vi.stubGlobal('ClipboardItem', FakeClipboardItem);
vi.stubGlobal('navigator', {
  clipboard: {
    write: async ([item]: FakeClipboardItem[]) => {
      if (failWrites) throw new Error('denied');
      written = Object.fromEntries(await Promise.all(Object.entries(item!.items).map(async ([k, v]) => [k, await v])));
    },
  },
});

const { addPhotosToPile } = await import('./actions');
const { copyPhotos, isInternalPaste, pasteCopied } = await import('./clipboard');
const { projectStore, emptyProject } = await import('./store');
const { ui } = await import('./ui');

/** What a paste event would carry after our copy (or after copying something else). */
const pasteData = async (text: string | null, files: File[] = []) =>
  ({ getData: () => text ?? '', files }) as unknown as DataTransfer;

beforeEach(() => {
  images.clear();
  written = {};
  failWrites = false;
  projectStore.reset(emptyProject());
  addPhotosToPile([
    { id: A, name: 'a.jpg', pxW: 100, pxH: 100 },
    { id: B, name: 'b.jpg', pxW: 100, pxH: 100 },
  ]);
  images.set(A, { full: new Blob([A]), thumb: new Blob([A]) });
  images.set(B, { full: new Blob([B]), thumb: new Blob([B]) });
});

describe('copy and paste', () => {
  it('puts the image and a marker on the system clipboard', async () => {
    await copyPhotos([A]);
    expect(Object.keys(written).sort()).toEqual(['image/png', 'text/plain']);
  });

  it('pastes copied photos as duplicates, selected, cascading with each paste', async () => {
    await copyPhotos([A, B]);
    const marker = await written['text/plain']!.text();
    expect(isInternalPaste(await pasteData(marker))).toBe(true);

    await pasteCopied();
    await pasteCopied();
    const pile = projectStore.project.pile;
    expect(pile).toHaveLength(6);
    const a = pile.find((p) => p.photoId === A)!;
    const copiesOfA = pile.filter((p) => projectStore.project.photos[p.photoId]!.name === 'a copy.jpg');
    // Each paste steps further, in proportion to the photo.
    const step = (0.25 * Math.max(a.w, a.h)) / 2;
    expect(copiesOfA.map((p) => Math.round(((p.x - a.x) / step) * 100) / 100)).toEqual([1, 2]);
    expect(ui.get().selection).toHaveLength(2);
  });

  it('treats a paste as external once something else was copied', async () => {
    await copyPhotos([A]);
    expect(isInternalPaste(await pasteData('some other text'))).toBe(false);
    expect(isInternalPaste(await pasteData(null, [new File(['x'], 'image.png')]))).toBe(false);
  });

  it('still pastes inside the app when the system clipboard is unavailable', async () => {
    failWrites = true;
    await copyPhotos([A]).catch(() => {});
    expect(isInternalPaste(await pasteData(null))).toBe(true);
  });
});
