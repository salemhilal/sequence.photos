import { describe, expect, it } from 'vitest';
import { toPhotoId, toSpreadId } from '../ids';
import { validateProject } from '../validate';
import { addPhotos, framesOf } from './frameActions';
import { photoAt } from './layout';
import { editedLabel, entryFor, newSequence, withEntry, type LibraryEntry } from './library';
import { dropIndex, toggled } from './nav';
import { produce } from 'immer';

const A = toPhotoId('a');
const B = toPhotoId('b');

describe('newSequence', () => {
  it('is one empty frame at Instagram’s portrait size, with a border guide 5% in to drop into', () => {
    const p = newSequence();
    expect(p.page).toEqual({ w: 1080, h: 1350, unit: 'px', pxPerUnit: 1 });
    expect(framesOf(p)).toHaveLength(1);
    expect(p.settings.borders).toEqual([{ id: p.settings.dropBorder, kind: 'even', inset: 54 }]);
    expect(() => validateProject(p)).not.toThrow();
  });
});

describe('the list', () => {
  const p = produce(newSequence(), (d) =>
    addPhotos(
      d,
      [A, B].map((id) => ({ id, name: `${id}.jpg`, pxW: 800, pxH: 1200 })),
      'frames',
    ),
  );

  it('lists a project with its first frames and their photos', () => {
    const e = entryFor('x', 'Walks', p, 5);
    expect(e).toMatchObject({ id: 'x', name: 'Walks', updated: 5, frameCount: 3 });
    expect(e.cover.frames).toHaveLength(3);
    expect(Object.keys(e.cover.photos).sort()).toEqual([A, B]);
  });

  it('keeps the most recently changed first, each once', () => {
    const entry = (id: string, updated: number): LibraryEntry => entryFor(id, id, p, updated);
    const list = [entry('a', 3), entry('b', 2)];
    expect(withEntry(list, entry('c', 1)).map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(withEntry(list, entry('b', 9)).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('says when each was edited', () => {
    const now = new Date(2026, 9, 28, 12).getTime();
    expect(editedLabel(new Date(2026, 9, 28, 8).getTime(), now)).toBe('Edited today');
    expect(editedLabel(new Date(2026, 9, 12).getTime(), now)).toBe('Edited Oct 12');
    expect(editedLabel(new Date(2025, 9, 12).getTime(), now)).toBe('Edited Oct 12, 2025');
  });
});

describe('the frames grid', () => {
  it('toggles a frame in and out of the selection', () => {
    const [x, y] = [toSpreadId('x'), toSpreadId('y')];
    expect(toggled([x], y)).toEqual([x, y]);
    expect(toggled([x, y], x)).toEqual([y]);
  });

  it('drops before the cell whose middle is past the finger, reading across rows', () => {
    // Two columns, two rows of 100 × 120 cells.
    const cells = [
      { left: 0, top: 0, width: 100, height: 120 },
      { left: 110, top: 0, width: 100, height: 120 },
      { left: 0, top: 130, width: 100, height: 120 },
      { left: 110, top: 130, width: 100, height: 120 },
    ];
    expect(dropIndex(cells, 10, 60)).toBe(0);
    expect(dropIndex(cells, 70, 60)).toBe(1);
    expect(dropIndex(cells, 200, 60)).toBe(2);
    expect(dropIndex(cells, 120, 200)).toBe(3);
    expect(dropIndex(cells, 200, 200)).toBe(4);
    expect(dropIndex(cells, 50, 400)).toBe(4);
  });
});

describe('photoAt', () => {
  const items = [
    { photoId: A, x: 0, y: 0, w: 100, h: 100, z: 1 },
    { photoId: B, x: 50, y: 50, w: 100, h: 100, z: 2, border: { width: 10, color: 'white' as const } },
  ];
  it('finds the topmost photo under a point, its border included', () => {
    expect(photoAt(items, 75, 75)?.photoId).toBe(B);
    expect(photoAt(items, 20, 20)?.photoId).toBe(A);
    expect(photoAt(items, 155, 155)?.photoId).toBe(B);
    expect(photoAt(items, 170, 170)).toBeUndefined();
  });
});
