import { describe, expect, it } from 'vitest';
import { convertUnits, rearrange, resizePage, scaleProject } from './convertLayout';
import { borderBox, lineAt, linePosition, pageRect, sideAt } from './geometry';
import { toGuideId, toPhotoId } from './ids';
import { allSpreads, sheetOf } from './spreads';
import { emptyProject } from './store';
import type { Placement, Project } from './types';

const A = toPhotoId('a');
const B = toPhotoId('b');

/** A book (four spreads) with a photo on a middle spread's left page and one across its gutter. */
function book(): Project {
  const p = emptyProject();
  p.settings.lines = [{ id: toGuideId('v'), axis: 'vertical', at: 2 }];
  p.photos[A] = { id: A, name: 'a.jpg', pxW: 3000, pxH: 2000 };
  p.photos[B] = { id: B, name: 'b.jpg', pxW: 3000, pxH: 2000 };
  allSpreads(p)[1]!.items.push(
    { photoId: A, x: -9, y: 1, w: 6, h: 4, z: 1 },
    // Its center is 1 in right of the gutter.
    { photoId: B, x: -2, y: 1, w: 6, h: 4, z: 2 },
  );
  p.nextZ = 3;
  return p;
}

const round = (r: Placement) => ({
  ...r,
  x: +r.x.toFixed(6),
  y: +r.y.toFixed(6),
  w: +r.w.toFixed(6),
  h: +r.h.toFixed(6),
});

describe('rearrange: spreads to frames', () => {
  it('makes each page a frame, in book order, keeping the first page’s spread id', () => {
    const p = book();
    const d = rearrange(p, 'frames');
    expect(d.layout.kind).toBe('frames');
    const frames = allSpreads(d);
    // A first page, two spreads of two pages, a last page.
    expect(frames.map((f) => f.kind)).toEqual(Array(6).fill('frame'));
    const ids = allSpreads(p).map((s) => s.id);
    expect(frames[0]!.id).toBe(ids[0]);
    expect(frames[1]!.id).toBe(ids[1]);
    expect(frames[3]!.id).toBe(ids[2]);
    expect(frames[5]!.id).toBe(ids[3]);
    expect(new Set(frames.map((f) => f.id)).size).toBe(6);
  });

  it('keeps the page size, unit, and guides', () => {
    const p = book();
    const d = rearrange(p, 'frames');
    expect(d.page).toEqual(p.page);
    expect(d.settings).toBe(p.settings);
  });

  it('gives each photo to the page holding its center, measured from that page’s left edge', () => {
    const frames = allSpreads(rearrange(book(), 'frames'));
    expect(frames[1]!.items.map(round)).toEqual([{ photoId: A, x: 1, y: 1, w: 6, h: 4, z: 1 }]);
    // Hanging off the frame's left edge, as it hung across the gutter.
    expect(frames[2]!.items.map(round)).toEqual([{ photoId: B, x: -2, y: 1, w: 6, h: 4, z: 2 }]);
  });
});

describe('rearrange: backgrounds', () => {
  it('gives each frame its spread’s background', () => {
    const p = book();
    allSpreads(p)[1]!.background = 'black';
    const frames = allSpreads(rearrange(p, 'frames'));
    expect(frames.map((f) => f.background ?? 'white')).toEqual(['white', 'black', 'black', 'white', 'white', 'white']);
  });
});

describe('rearrange: frames to spreads', () => {
  it('comes back as the same book', () => {
    const p = book();
    const back = rearrange(rearrange(p, 'frames'), 'spreads');
    expect(back.layout.kind).toBe('spreads');
    expect(allSpreads(back).map((s) => [s.kind, s.id])).toEqual(allSpreads(p).map((s) => [s.kind, s.id]));
    expect(allSpreads(back).flatMap((s) => s.items.map(round))).toEqual(allSpreads(p).flatMap((s) => s.items));
  });

  it('makes frame 1 the first page, pairs the rest, and gives a book an empty last page if none is left over', () => {
    const d = rearrange(book(), 'frames');
    if (d.layout.kind !== 'frames') throw new Error('not frames');
    const [one, two, three] = d.layout.frames;
    d.layout.frames = [one, two!, three!];
    const p = rearrange(d, 'spreads');
    const spreads = allSpreads(p);
    expect(spreads.map((s) => s.kind)).toEqual(['first', 'middle', 'last']);
    expect(spreads[1]!.id).toBe(two!.id);
    // Frame 2 on the left page, frame 3 on the right.
    expect(spreads[1]!.items.map((i) => i.photoId)).toEqual([A, B]);
    expect(spreads[2]!.items).toEqual([]);
    expect(new Set(spreads.map((s) => s.id)).size).toBe(3);
  });

  it('leaves a project already arranged that way alone', () => {
    const p = book();
    expect(rearrange(p, 'spreads')).toBe(p);
  });
});

describe('convertUnits', () => {
  it('multiplies by the dpi going to pixels', () => {
    const d = convertUnits(book(), 'px', 300);
    expect(d.page).toEqual({ w: 3000, h: 2400, unit: 'px', pxPerUnit: 1 });
    const s = sheetOf(d);
    expect(s.borders.map((b) => b.kind === 'even' && b.inset)).toEqual([150, 375]);
    expect(s.lines.map((l) => l.at)).toEqual([600]);
    expect(allSpreads(d)[1]!.items[0]).toEqual({ photoId: A, x: -2700, y: 300, w: 1800, h: 1200, z: 1 });
  });

  it('divides by the dpi going to inches, which becomes the page’s', () => {
    const px: Project = { ...emptyProject(), page: { w: 1080, h: 1350, unit: 'px', pxPerUnit: 1 } };
    expect(convertUnits(px, 'in', 300).page).toEqual({ w: 3.6, h: 4.5, unit: 'in', pxPerUnit: 300 });
  });

  it('comes back from a round trip', () => {
    const p = book();
    const back = convertUnits(convertUnits(p, 'px', 300), 'in', 300);
    expect(back.page).toEqual(p.page);
    allSpreads(back).forEach((s, i) =>
      s.items.forEach((item, j) => {
        const was = allSpreads(p)[i]!.items[j]!;
        for (const k of ['x', 'y', 'w', 'h'] as const) expect(item[k]).toBeCloseTo(was[k], 9);
      }),
    );
  });

  it('leaves the desk in inches', () => {
    const p = book();
    p.pile.push({ photoId: toPhotoId('c'), x: 1, y: 1, w: 2, h: 2, z: 5 });
    expect(convertUnits(p, 'px', 300).pile).toBe(p.pile);
  });
});

describe('scaleProject', () => {
  it('scales the page, photos, and guides by one factor', () => {
    const d = scaleProject(book(), 108, 'px', 1);
    expect(d.page).toEqual({ w: 1080, h: 864, unit: 'px', pxPerUnit: 1 });
    expect(sheetOf(d).borders.map((b) => b.kind === 'even' && b.inset)).toEqual([54, 135]);
  });

  it('scales photos’ borders too', () => {
    const p = book();
    allSpreads(p)[1]!.items[0]!.border = { width: 0.25, color: 'white' };
    expect(allSpreads(scaleProject(p, 108, 'px', 1))[1]!.items[0]!.border).toEqual({ width: 27, color: 'white' });
  });
});

describe('resizePage', () => {
  it('moves photos with the guides, or keeps them', () => {
    const p = book();
    const kept = resizePage(p, { w: 8, h: 8 }, false);
    expect(allSpreads(kept)[1]!.items).toEqual(allSpreads(p)[1]!.items);
    const moved = resizePage(p, { w: 8, h: 8 }, true);
    expect(allSpreads(moved)[1]!.items[0]!.x).not.toBe(-9);
    expect(moved.page).toEqual({ ...p.page, w: 8 });
  });
});

describe('frames', () => {
  const s = sheetOf(convertUnits(rearrange(book(), 'frames'), 'px', 108));

  it('are one page, measured from the left', () => {
    expect(sideAt(s, -50)).toBe('whole');
    expect(sideAt(s, 900)).toBe('whole');
    expect(pageRect('whole', s)).toEqual({ x: 0, y: 0, w: 1080, h: 864 });
    expect(linePosition('whole', s, s.lines[0]!)).toBe(216);
    expect(lineAt('whole', s, 'vertical', 216)).toBe(216);
  });

  it('put a border guide’s outside distance on the left', () => {
    const g = { id: toGuideId('g'), kind: 'edges', top: 10, bottom: 20, outside: 30, inside: 40 } as const;
    expect(borderBox('whole', s, g)).toEqual({ x: 30, y: 10, w: 1080 - 70, h: 864 - 30 });
  });
});

describe('anchorShift', () => {
  it('moves with the point a photo is kept fixed to', async () => {
    const { anchorShift } = await import('./convertLayout');
    expect(anchorShift('center', 'right', 2, 4)).toEqual({ dx: 1, dy: 2 });
    expect(anchorShift('center', 'left', 2, 4)).toEqual({ dx: -1, dy: 2 });
    expect(anchorShift('top-left', 'left', 2, 4)).toEqual({ dx: -2, dy: 0 });
    expect(anchorShift('top-left', 'whole', 2, 4)).toEqual({ dx: 0, dy: 0 });
    expect(anchorShift('inside', 'left', 2, 4)).toEqual({ dx: 0, dy: 0 });
  });
});
