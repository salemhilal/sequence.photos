import { beforeEach, describe, expect, it } from 'vitest';
import { toPhotoId } from './ids';
import { checkResolution, coverage, isSoft, resolutionNote, softLabel, softPhotos, softSentence } from './resolution';
import { allSpreads } from './spreads';
import { emptyProject, projectStore } from './store';
import type { Project } from './types';
import { ui } from './ui';

const A = toPhotoId('a');
const B = toPhotoId('b');

/** A 10 × 8 in book at 300 dpi: a 3000 px photo 10 in wide (enough), a 1500 px one 6 in wide (not). */
function book(): Project {
  const p = emptyProject();
  p.photos[A] = { id: A, name: 'a.jpg', pxW: 3000, pxH: 2000 };
  p.photos[B] = { id: B, name: 'b.jpg', pxW: 1500, pxH: 1000 };
  allSpreads(p)[1]!.items.push({ photoId: A, x: -10, y: 0, w: 10, h: 20 / 3, z: 1 });
  allSpreads(p)[2]!.items.push({ photoId: B, x: 0, y: 0, w: 6, h: 4, z: 2 });
  return p;
}

const sheet = { unit: 'in', pxPerUnit: 300 } as const;
const pixels = { unit: 'px', pxPerUnit: 1 } as const;

describe('coverage', () => {
  it('is the photo’s pixels per output pixel', () => {
    expect(coverage({ pxW: 3000, pxH: 2000 }, { w: 10, h: 20 / 3 }, 300)).toBeCloseTo(1);
    expect(coverage({ pxW: 3000, pxH: 2000 }, { w: 12, h: 8 }, 300)).toBeCloseTo(0.833, 3);
    expect(coverage({ pxW: 1080, pxH: 1350 }, { w: 1296, h: 1620 }, 1)).toBeCloseTo(0.833, 3);
  });

  it('counts a stretched photo’s thinner side', () => {
    // Wide enough, but stretched to twice its height.
    expect(coverage({ pxW: 3000, pxH: 2000 }, { w: 10, h: 40 / 3 }, 300)).toBeCloseTo(0.5);
  });

  it('lets a hair under 1 pass', () => {
    expect(isSoft(0.995)).toBe(false);
    expect(isSoft(0.98)).toBe(true);
  });

  it('changes with the dpi', () => {
    expect(isSoft(coverage({ pxW: 1500, pxH: 1000 }, { w: 6, h: 4 }, 300))).toBe(true);
    expect(isSoft(coverage({ pxW: 1500, pxH: 1000 }, { w: 6, h: 4 }, 250))).toBe(false);
  });
});

describe('resolutionNote', () => {
  const photo = { id: A, name: '', pxW: 1500, pxH: 1000 };
  const at = (w: number) => ({ photoId: A, x: 0, y: 0, w, h: (w * 2) / 3, z: 1 });

  it('gives inches’ ppi, saying when it’s below the dpi', () => {
    expect(resolutionNote(photo, at(6), sheet)).toEqual({ text: '250 ppi · below 300 dpi', soft: true });
    expect(resolutionNote(photo, at(5), sheet)).toEqual({ text: '300 ppi', soft: false });
  });

  it('gives pixels’ enlargement, only when enlarged', () => {
    expect(resolutionNote(photo, at(1800), pixels)).toEqual({ text: 'Enlarged 120%', soft: true });
    expect(resolutionNote(photo, at(1500), pixels)).toBeNull();
  });

  it('words counts', () => {
    expect(softLabel(2, sheet)).toBe('2 photos below 300 dpi');
    expect(softLabel(1, pixels)).toBe('1 photo enlarged');
    expect(softSentence(2, sheet)).toBe('2 photos are below 300 dpi.');
    expect(softSentence(1, pixels)).toBe('1 photo is enlarged.');
    expect(softSentence(3, sheet, true)).toBe('3 photos would be below 300 dpi.');
  });
});

describe('softPhotos', () => {
  it('lists placed photos below the page’s resolution, in book order', () => {
    const p = book();
    expect(softPhotos(p)).toEqual([{ photoId: B, spreadId: allSpreads(p)[2]!.id }]);
    expect(softPhotos({ ...p, page: { ...p.page, pxPerUnit: 250 } })).toEqual([]);
  });
});

describe('checkResolution', () => {
  beforeEach(() => ui.set({ confirm: null, editingSpreadId: null, editorSelect: null, modal: null }));

  /** Answer the confirmation showing by clicking the button with this label. */
  const pick = (label: string) => {
    const c = ui.get().confirm!;
    c.choose(c.actions.findIndex((a) => a.label === label));
  };

  it('goes ahead without asking when every photo has enough detail', async () => {
    projectStore.reset({ ...book(), page: { ...book().page, pxPerUnit: 200 } });
    expect(await checkResolution()).toBe(true);
    expect(ui.get().confirm).toBeNull();
  });

  it('asks, and exports anyway when told to', async () => {
    projectStore.reset(book());
    const answer = checkResolution();
    expect(ui.get().confirm!.message).toBe('1 photo is below 300 dpi.');
    pick('Export anyway');
    expect(await answer).toBe(true);
  });

  it('shows the first one in the editor, selected', async () => {
    const p = book();
    projectStore.reset(p);
    ui.set({ modal: 'preview' });
    const answer = checkResolution();
    pick('Show me');
    expect(await answer).toBe(false);
    expect(ui.get()).toMatchObject({ modal: null, editingSpreadId: allSpreads(p)[2]!.id, editorSelect: B });
  });
});
