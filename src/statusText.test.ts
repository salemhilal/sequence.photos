import { describe, expect, it } from 'vitest';
import { rearrange } from './convertLayout';
import { toPhotoId } from './ids';
import { allSpreads } from './spreads';
import { statusText } from './statusText';
import { emptyProject } from './store';
import type { Project } from './types';

const A = toPhotoId('a');
const B = toPhotoId('b');
const C = toPhotoId('c');

/** A book with photo A on the desk and B and C placed (C twice, as a copy would be). */
function book(): Project {
  const p = emptyProject();
  p.pile.push({ photoId: A, x: 0, y: 0, w: 2, h: 2, z: 1 });
  allSpreads(p)[1]!.items.push(
    { photoId: B, x: 0, y: 0, w: 2, h: 2, z: 2 },
    { photoId: C, x: 3, y: 0, w: 2, h: 2, z: 3 },
  );
  allSpreads(p)[2]!.items.push({ photoId: C, x: 0, y: 0, w: 2, h: 2, z: 4 });
  return p;
}

const desk: Parameters<typeof statusText>[1] = {
  hint: null,
  pageStatus: null,
  page: 'desk',
  selection: [],
  spreadSelection: [],
};

describe('statusText', () => {
  it('counts photos on the desk and placed ones, each once', () => {
    expect(statusText(book(), desk)).toBe('1 on desk, 2 placed');
  });

  it('says what’s selected instead: photos, else spreads (or frames)', () => {
    const p = book();
    const ids = allSpreads(p).map((s) => s.id);
    expect(statusText(p, { ...desk, selection: [A] })).toBe('1 photo selected');
    expect(statusText(p, { ...desk, selection: [A, B] })).toBe('2 photos selected');
    expect(statusText(p, { ...desk, spreadSelection: ids.slice(0, 2) })).toBe('2 spreads selected');
    expect(statusText(rearrange(p, 'frames'), { ...desk, spreadSelection: ids.slice(0, 1) })).toBe('1 frame selected');
  });

  it('gives way to what the open page or editor says, and on another page says only that', () => {
    expect(statusText(book(), { ...desk, selection: [A], pageStatus: 'Arrows nudge' })).toBe('Arrows nudge');
    expect(statusText(book(), { ...desk, page: 'export', pageStatus: '10 × 8 in' })).toBe('10 × 8 in');
    expect(statusText(book(), { ...desk, page: 'preview' })).toBeNull();
  });

  it('puts a hint before everything', () => {
    expect(
      statusText(book(), { ...desk, page: 'export', pageStatus: '10 × 8 in', hint: 'Swap width and height' }),
    ).toBe('Swap width and height');
  });
});
