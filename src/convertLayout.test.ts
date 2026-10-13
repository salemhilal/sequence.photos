import { describe, expect, it } from 'vitest';
import { convertLayout } from './convertLayout';
import { borderBox, lineAt, linePosition, pageRect, sideAt } from './geometry';
import { toGuideId, toPhotoId } from './ids';
import { allSpreads, sheetOf } from './spreads';
import { switchLayout } from './pageSize';
import { emptyProject, projectStore } from './store';
import type { Placement, Project } from './types';

const A = toPhotoId('a');
const B = toPhotoId('b');

/** A book (four spreads) with a photo on a middle spread's left page and one across its gutter. */
function book(keepRelative = false): Project {
  const p = emptyProject();
  p.settings.keepRelative = keepRelative;
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

describe('print to digital', () => {
  it('makes each page a frame, in book order, keeping the first page’s spread id', () => {
    const p = book();
    const d = convertLayout(p, 'digital');
    expect(d.layout.kind).toBe('digital');
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

  it('gives each photo to the page holding its center, in pixels from that page’s left edge', () => {
    const d = convertLayout(book(), 'digital');
    const frames = allSpreads(d);
    // 1080 px across a 10 in page: 108 px to the inch.
    expect(frames[1]!.items.map(round)).toEqual([{ photoId: A, x: 108, y: 108, w: 648, h: 432, z: 1 }]);
    // Hanging off the frame's left edge, as it hung across the gutter.
    expect(frames[2]!.items.map(round)).toEqual([{ photoId: B, x: -216, y: 108, w: 648, h: 432, z: 2 }]);
  });

  it('converts guides in proportion to the page width, and takes the frame size', () => {
    const d = convertLayout(book(), 'digital');
    const s = sheetOf(d);
    expect([s.pageW, s.pageH]).toEqual([1080, 1350]);
    expect(s.borders.map((b) => b.kind === 'even' && b.inset)).toEqual([54, 135]);
    expect(s.lines.map((l) => l.at)).toEqual([216]);
    // The book's size is remembered for coming back.
    expect(d.settings.sizes.print).toEqual({ w: 10, h: 8 });
  });

  it('moves photos with the guides to the frame’s shape, when they’re kept relative', () => {
    const d = convertLayout(book(true), 'digital');
    const a = allSpreads(d)[1]!.items[0]!;
    // Still 54 px in from the left edge's 0.5 in guide, give or take; now on a taller frame.
    expect(a.x).toBeCloseTo(108);
    expect(a.y).toBeGreaterThan(108);
  });
});

describe('digital to print', () => {
  it('comes back as the same book', () => {
    for (const keep of [false, true]) {
      const p = book(keep);
      const back = convertLayout(convertLayout(p, 'digital'), 'print');
      expect(back.layout.kind).toBe('print');
      expect(allSpreads(back).map((s) => [s.kind, s.id])).toEqual(allSpreads(p).map((s) => [s.kind, s.id]));
      expect(back.settings).toEqual(p.settings);
      // Photos moved with the guides to the frame's shape are refit there, so only those
      // left where they were come back exactly (switchLayout covers going straight back).
      if (!keep) {
        expect(allSpreads(back).flatMap((s) => s.items.map(round))).toEqual(allSpreads(p).flatMap((s) => s.items));
      }
    }
  });

  it('makes frame 1 the first page, pairs the rest, and gives a book an empty last page if none is left over', () => {
    const d = convertLayout(book(), 'digital');
    if (d.layout.kind !== 'digital') throw new Error('not digital');
    const [one, two, three] = d.layout.frames;
    d.layout.frames = [one, two!, three!];
    const p = convertLayout(d, 'print');
    const spreads = allSpreads(p);
    expect(spreads.map((s) => s.kind)).toEqual(['first', 'middle', 'last']);
    expect(spreads[1]!.id).toBe(two!.id);
    // Frame 2 on the left page, frame 3 on the right.
    expect(spreads[1]!.items.map((i) => i.photoId)).toEqual([A, B]);
    expect(spreads[2]!.items).toEqual([]);
    expect(new Set(spreads.map((s) => s.id)).size).toBe(3);
  });

  it('leaves a project already of that kind alone', () => {
    const p = book();
    expect(convertLayout(p, 'print')).toBe(p);
  });
});

describe('switchLayout', () => {
  it('is one undo step, and switching straight back restores the project exactly', () => {
    const p = book(true);
    projectStore.reset(p);
    switchLayout('digital');
    expect(projectStore.project.layout.kind).toBe('digital');
    switchLayout('print');
    expect(projectStore.project).toBe(p);
    projectStore.undo();
    projectStore.undo();
    expect(projectStore.project).toBe(p);
  });

  it('switches at a size of its own in the same step, remembering it', () => {
    const p = book();
    projectStore.reset(p);
    switchLayout('digital', { w: 1080, h: 1080 });
    const s = sheetOf(projectStore.project);
    expect([s.layout, s.pageW, s.pageH]).toEqual(['digital', 1080, 1080]);
    expect(projectStore.project.settings.sizes.digital).toEqual({ w: 1080, h: 1080 });
    projectStore.undo();
    expect(projectStore.project).toBe(p);
  });

  it('converts afresh after any other change', () => {
    projectStore.reset(book(true));
    switchLayout('digital');
    projectStore.apply((d) => void (d.settings.centerH = false));
    switchLayout('print');
    expect(projectStore.project.settings.centerH).toBe(false);
  });
});

describe('frames', () => {
  const s = sheetOf(convertLayout(book(), 'digital'));

  it('are one page, measured from the left', () => {
    expect(sideAt(s, -50)).toBe('whole');
    expect(sideAt(s, 900)).toBe('whole');
    expect(pageRect('whole', s)).toEqual({ x: 0, y: 0, w: 1080, h: 1350 });
    expect(linePosition('whole', s, s.lines[0]!)).toBe(216);
    expect(lineAt('whole', s, 'vertical', 216)).toBe(216);
  });

  it('put a border guide’s outside distance on the left', () => {
    const g = { id: toGuideId('g'), kind: 'edges', top: 10, bottom: 20, outside: 30, inside: 40 } as const;
    expect(borderBox('whole', s, g)).toEqual({ x: 30, y: 10, w: 1080 - 70, h: 1350 - 30 });
  });
});
