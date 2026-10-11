import { describe, expect, it } from 'vitest';
import {
  borderBox,
  clampBorder,
  fmt,
  dropBox,
  dropGuide,
  fitCentered,
  lineAt,
  linePosition,
  pageRect,
  relayoutRect,
  resizeRect,
  snapLines,
  snapMove,
  spreadGuides,
  type Rect,
} from './geometry';
import { toGuideId, toSpreadId } from './ids';
import type { BorderGuide, Sheet, Spread } from './types';

function even(id: string, inset: number): BorderGuide {
  return { id: toGuideId(id), kind: 'even', inset };
}

const settings: Sheet = {
  layout: 'print',
  pageW: 10,
  pageH: 8,
  centerV: true,
  centerH: true,
  keepRelative: true,
  borders: [even('a', 0.5), even('b', 1.25)],
  lines: [],
  dropBorder: null,
};
/** Wider at the gutter and the bottom, as books often are. */
const book: BorderGuide = { id: toGuideId('book'), kind: 'edges', top: 0.5, bottom: 1, inside: 1.5, outside: 0.75 };
const spread = (kind: Spread['kind']): Spread => ({ id: toSpreadId('s'), kind, items: [] });
const photo = (pxW: number, pxH: number) => ({ id: 'p', name: 'p.jpg', pxW, pxH });
const round = (r: Rect) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));

describe('pages', () => {
  it('places the left page before the gutter and the right page after it', () => {
    expect(pageRect('left', settings)).toEqual({ x: -10, y: 0, w: 10, h: 8 });
    expect(pageRect('right', settings)).toEqual({ x: 0, y: 0, w: 10, h: 8 });
  });

  it('fits dropped photos inside the border guide with the largest box', () => {
    expect(dropGuide(settings)?.id).toBe('a');
    expect(dropBox('right', settings)).toEqual({ x: 0.5, y: 0.5, w: 9, h: 7 });
    expect(dropBox('right', { ...settings, borders: [] })).toEqual(pageRect('right', settings));
  });

  it('fits dropped photos inside the border guide chosen for it, by id', () => {
    expect(dropGuide({ ...settings, dropBorder: toGuideId('b') })?.id).toBe('b');
    // A choice that's gone falls back to the largest.
    expect(dropGuide({ ...settings, dropBorder: toGuideId('gone') })?.id).toBe('a');
  });

  it('keeps border guides on a page that shrinks', () => {
    const small = { ...settings, pageW: 2, pageH: 2 };
    const g: BorderGuide = { ...book };
    clampBorder(g, small);
    const b = borderBox('right', small, g);
    expect(b.w).toBeGreaterThanOrEqual(0.25 - 1e-9);
    expect(b.h).toBeGreaterThanOrEqual(0.25 - 1e-9);
    const e = even('e', 3);
    clampBorder(e, small);
    expect(e).toEqual(even('e', 0.875));
  });

  it('mirrors a border guide on facing pages: inside is at the gutter', () => {
    const s = { ...settings, borders: [book] };
    expect(borderBox('right', s, book)).toEqual({ x: 1.5, y: 0.5, w: 7.75, h: 6.5 });
    expect(borderBox('left', s, book)).toEqual({ x: -9.25, y: 0.5, w: 7.75, h: 6.5 });
  });
});

describe('fitCentered', () => {
  const box = { x: 0.5, y: 0.5, w: 9, h: 7 }; // the right page, 0.5 in in

  it('fits a landscape photo to the box width', () => {
    expect(round(fitCentered(photo(1800, 1000), box))).toEqual({ x: 0.5, y: 1.5, w: 9, h: 5 });
  });

  it('fits a portrait photo to the box height, centered', () => {
    expect(round(fitCentered(photo(800, 1000), box))).toEqual({ x: 2.2, y: 0.5, w: 5.6, h: 7 });
  });
});

describe('guides', () => {
  it('includes center lines and border guides for each page', () => {
    const g = spreadGuides(spread('middle'), settings);
    expect(g.xs).toEqual(expect.arrayContaining([-5, 5, -9.5, -0.5, 0.5, 9.5, -8.75, 8.75]));
    expect(g.ys).toEqual(expect.arrayContaining([4, 0.5, 7.5, 1.25, 6.75]));
  });

  it('draws per-edge border guides mirrored on each page', () => {
    const g = spreadGuides(spread('middle'), { ...settings, centerV: false, centerH: false, borders: [book] });
    expect(g.xs.sort((a, b) => a - b)).toEqual([-9.25, -1.5, 1.5, 9.25]);
    expect(g.ys).toEqual([0.5, 7]);
  });

  it('places vertical line guides from each page’s outside edge, and horizontal ones from the top', () => {
    const s: Sheet = {
      ...settings,
      centerV: false,
      centerH: false,
      borders: [],
      lines: [
        { id: toGuideId('v'), axis: 'vertical', at: 2 },
        { id: toGuideId('h'), axis: 'horizontal', at: 3 },
        // Off the page: not drawn.
        { id: toGuideId('off'), axis: 'vertical', at: 12 },
      ],
    };
    const g = spreadGuides(spread('middle'), s);
    expect(g.xs.sort((a, b) => a - b)).toEqual([-8, 8]);
    expect(g.ys).toEqual([3]);
  });

  it('finds a vertical guide’s distance from the outside edge on either page', () => {
    const l = { id: toGuideId('v'), axis: 'vertical' as const, at: 2 };
    for (const side of ['left', 'right'] as const) {
      expect(lineAt(side, settings, 'vertical', linePosition(side, settings, l))).toBeCloseTo(2);
    }
  });

  it('omits the missing page on the first spread', () => {
    const g = spreadGuides(spread('first'), settings);
    expect(g.xs.every((x) => x >= 0)).toBe(true);
  });

  it('omits center lines when they are turned off', () => {
    const g = spreadGuides(spread('middle'), { ...settings, centerV: false, centerH: false, borders: [] });
    expect(g).toEqual({ xs: [], ys: [] });
  });

  it('lets photos snap to page edges and the gutter', () => {
    const lines = snapLines(spread('middle'), settings);
    expect(lines.xs).toEqual(expect.arrayContaining([-10, 0, 10]));
    expect(lines.ys).toEqual(expect.arrayContaining([0, 8]));
  });
});

describe('snapMove', () => {
  const lines = snapLines(spread('middle'), settings);

  it('snaps a nearby edge to a guide', () => {
    const { rect, hit } = snapMove({ x: 0.6, y: 3, w: 2, h: 1 }, lines, 0.2);
    expect(rect.x).toBeCloseTo(0.5);
    expect(hit.xs).toEqual([0.5]);
  });

  it('snaps a photo center to the page center', () => {
    const { rect } = snapMove({ x: 3.9, y: 3.05, w: 2, h: 2 }, lines, 0.2);
    expect(rect.x + rect.w / 2).toBeCloseTo(5);
    expect(rect.y + rect.h / 2).toBeCloseTo(4);
  });

  it('leaves a photo alone when nothing is within the threshold', () => {
    const r = { x: 2.1, y: 2.1, w: 1, h: 1 };
    expect(snapMove(r, lines, 0.05).rect).toEqual(r);
  });
});

describe('resizeRect', () => {
  const start = { x: 1, y: 1, w: 4, h: 2 };

  it('keeps the aspect ratio when locked', () => {
    const { rect } = resizeRect(start, 'se', 2, 0, true, null, 0);
    expect(rect).toEqual({ x: 1, y: 1, w: 6, h: 3 });
  });

  it('anchors the opposite corner', () => {
    const { rect } = resizeRect(start, 'nw', -2, 0, true, null, 0);
    expect(rect.x + rect.w).toBe(5);
    expect(rect.y + rect.h).toBe(3);
  });

  it('resizes each axis freely when unlocked', () => {
    const { rect } = resizeRect(start, 'se', 1, 3, false, null, 0);
    expect(rect).toEqual({ x: 1, y: 1, w: 5, h: 5 });
  });

  it('snaps the dragged corner to a guide', () => {
    const lines = snapLines(spread('middle'), settings);
    const { rect, hit } = resizeRect(start, 'se', 4.45, 0, true, lines, 0.1);
    expect(rect.x + rect.w).toBeCloseTo(9.5);
    expect(rect.w / rect.h).toBeCloseTo(2);
    expect(hit.xs).toEqual([9.5]);
  });
});

describe('relayoutRect', () => {
  const to = (pageW: number, pageH: number) => ({ ...settings, pageW, pageH });

  it('keeps a full-page photo filling the page', () => {
    expect(round(relayoutRect({ x: 0, y: 0, w: 10, h: 8 }, settings, to(8, 6.4)))).toEqual({
      x: 0,
      y: 0,
      w: 8,
      h: 6.4,
    });
  });

  it('keeps a full-spread photo spanning both pages', () => {
    expect(round(relayoutRect({ x: -10, y: 0, w: 20, h: 8 }, settings, to(8, 6.4)))).toEqual({
      x: -8,
      y: 0,
      w: 16,
      h: 6.4,
    });
  });

  it('keeps a photo on its border guides', () => {
    const r = relayoutRect({ x: 0.625, y: 0.5, w: 8.75, h: 7 }, settings, to(8, 6.4));
    expect(r.y).toBeCloseTo(0.5);
    expect(r.y + r.h).toBeCloseTo(5.9);
  });

  it('preserves proportions when the page shape changes, centered on the page', () => {
    const r = relayoutRect({ x: 0, y: 0, w: 10, h: 8 }, settings, to(9, 6));
    expect(round(r)).toEqual({ x: 0.75, y: 0, w: 7.5, h: 6 });
  });

  it('keeps a photo on per-edge border guides, on either page', () => {
    const s = { ...settings, borders: [book] };
    const to = { ...s, pageW: 8, pageH: 6.4 };
    for (const side of ['left', 'right'] as const) {
      const r = relayoutRect(borderBox(side, s, book), s, to);
      const target = borderBox(side, to, book);
      // Same proportions, so it fits the new box by one dimension and is centered in it.
      expect(r.x + r.w / 2).toBeCloseTo(target.x + target.w / 2);
      expect(r.y + r.h / 2).toBeCloseTo(target.y + target.h / 2);
    }
  });

  it('keeps a photo’s edge on a vertical line guide', () => {
    const s: Sheet = { ...settings, borders: [], lines: [{ id: toGuideId('v'), axis: 'vertical', at: 2 }] };
    const to = { ...s, pageW: 8, pageH: 6.4 };
    // On the right page, from the guide (8 in from the gutter) to the page's outside edge.
    const r = relayoutRect({ x: 8, y: 0, w: 2, h: 8 }, s, to);
    expect(r.x + r.w).toBeLessThanOrEqual(8 + 1e-9);
    expect(r.x).toBeGreaterThanOrEqual(6 - 1e-9);
  });

  it('changes nothing when the size is unchanged', () => {
    const r = { x: 1.3, y: 2.1, w: 3, h: 2 };
    expect(round(relayoutRect(r, settings, settings))).toEqual(r);
  });
});

describe('fmt', () => {
  it('shows eighths of an inch exactly, and anything else to the hundredth', () => {
    expect(fmt(2.875)).toBe('2.875');
    expect(fmt(0.125)).toBe('0.125');
    expect(fmt(2.68333)).toBe('2.68');
    expect(fmt(10)).toBe('10');
  });
});
