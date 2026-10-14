import { describe, expect, it } from 'vitest';
import { toPhotoId } from './ids';
import { firstNonEmpty, fitPixels, itemsOn, outputPages, planPage, slideKey } from './renderPlan';
import { allSpreads, sheetOf } from './spreads';
import { emptyProject } from './store';
import type { Project } from './types';

const A = toPhotoId('a');
const B = toPhotoId('b');

/** A 10 × 8 in book at 300 dpi: a photo on a middle spread's left page, one across its gutter. */
function book(): Project {
  const p = emptyProject();
  p.photos[A] = { id: A, name: 'a.jpg', pxW: 3000, pxH: 2000 };
  p.photos[B] = { id: B, name: 'b.jpg', pxW: 1500, pxH: 1000 };
  allSpreads(p)[1]!.items.push(
    { photoId: A, x: -9, y: 1, w: 6, h: 4, z: 2 },
    // 3 in across the gutter, 3 in onto the right page.
    { photoId: B, x: -3, y: 2, w: 6, h: 4, z: 1 },
  );
  return p;
}

describe('outputPages', () => {
  it('makes one per spread, or one per page in book order', () => {
    const p = book();
    expect(outputPages(p, 'spread').map((o) => o.part)).toEqual(['spread', 'spread', 'spread', 'spread']);
    expect(outputPages(p, 'page').map((o) => o.part)).toEqual(['right', 'left', 'right', 'left', 'right', 'left']);
  });

  it('makes one per frame either way', () => {
    const p = book();
    const frames: Project = {
      ...p,
      layout: { kind: 'frames', frames: [{ kind: 'frame', id: allSpreads(p)[0]!.id, items: [] }] },
    };
    expect(outputPages(frames, 'spread').map((o) => o.part)).toEqual(['whole']);
    expect(outputPages(frames, 'page').map((o) => o.part)).toEqual(['whole']);
  });

  it('names each uniquely', () => {
    const keys = outputPages(book(), 'page').map(slideKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('planPage', () => {
  it('sizes a spread and a page at the dpi', () => {
    const p = book();
    const s = sheetOf(p);
    const [spread] = outputPages(p, 'spread').slice(1);
    expect(planPage(spread!, s, p.photos)).toMatchObject({ pxW: 6000, pxH: 2400, pxPerUnit: 300 });
    const [, left] = outputPages(p, 'page');
    expect(planPage(left!, s, p.photos)).toMatchObject({ pxW: 3000, pxH: 2400 });
  });

  it('draws back to front, in output pixels, with each photo’s visible part', () => {
    const p = book();
    const spread = outputPages(p, 'spread')[1]!;
    const plan = planPage(spread, sheetOf(p), p.photos);
    expect(plan.draws.map((d) => d.photoId)).toEqual([B, A]);
    const a = plan.draws[1]!;
    expect(a.dst).toEqual({ x: 300, y: 300, w: 1800, h: 1200 });
    expect(a.src).toEqual({ x: 0, y: 0, w: 3000, h: 2000 });
  });

  it('splits a photo across the gutter between the two pages', () => {
    const p = book();
    const s = sheetOf(p);
    const [, left, right] = outputPages(p, 'page');
    const onLeft = planPage(left!, s, p.photos).draws.find((d) => d.photoId === B)!;
    const onRight = planPage(right!, s, p.photos).draws.find((d) => d.photoId === B)!;
    expect(onLeft.dst).toEqual({ x: 2100, y: 600, w: 900, h: 1200 });
    expect(onRight.dst).toEqual({ x: 0, y: 600, w: 900, h: 1200 });
    // Each page shows its half of the photo.
    expect(onLeft.src).toEqual({ x: 0, y: 0, w: 750, h: 1000 });
    expect(onRight.src).toEqual({ x: 750, y: 0, w: 750, h: 1000 });
  });

  it('crops a photo hanging off the edge, and leaves out one entirely off', () => {
    const p = book();
    const items = allSpreads(p)[1]!.items;
    items[0]!.x = -11; // 1 in off the left page's outside edge
    const s = sheetOf(p);
    const [, left, right] = outputPages(p, 'page');
    const a = planPage(left!, s, p.photos).draws.find((d) => d.photoId === A)!;
    expect(a.dst.x).toBe(0);
    expect(a.dst.w).toBe(1500);
    expect(a.src).toEqual({ x: 500, y: 0, w: 2500, h: 2000 });
    expect(planPage(right!, s, p.photos).draws.map((d) => d.photoId)).toEqual([B]);
  });

  it('lowers the resolution when asked, but never raises it', () => {
    const p = book();
    const s = sheetOf(p);
    const page = outputPages(p, 'page')[1]!;
    expect(planPage(page, s, p.photos, 72)).toMatchObject({ pxW: 720, pxH: 576, pxPerUnit: 72 });
    expect(planPage(page, s, p.photos, 600)).toMatchObject({ pxW: 3000, pxPerUnit: 300 });
  });

  it('works in pixels at 1×', () => {
    const p = book();
    const frames: Project = {
      ...p,
      page: { w: 1080, h: 1350, unit: 'px', pxPerUnit: 1 },
      layout: {
        kind: 'frames',
        frames: [
          { kind: 'frame', id: allSpreads(p)[0]!.id, items: [{ photoId: A, x: -100, y: 0, w: 1200, h: 800, z: 1 }] },
        ],
      },
    };
    const plan = planPage(outputPages(frames, 'page')[0]!, sheetOf(frames), frames.photos);
    expect(plan).toMatchObject({ pxW: 1080, pxH: 1350 });
    expect(plan.draws[0]!.dst).toEqual({ x: 0, y: 0, w: 1080, h: 800 });
    expect(plan.draws[0]!.src).toEqual({ x: 250, y: 0, w: 2700, h: 2000 });
  });
});

describe('fitPixels', () => {
  it('keeps a plan that fits, and lowers one that doesn’t to fit', () => {
    const p = book();
    const plan = planPage(outputPages(p, 'spread')[1]!, sheetOf(p), p.photos);
    expect(fitPixels(plan, 20_000_000)).toBe(300);
    const k = fitPixels(plan, 4_000_000);
    const smaller = planPage(outputPages(p, 'spread')[1]!, sheetOf(p), p.photos, k);
    expect(smaller.pxW * smaller.pxH).toBeLessThanOrEqual(4_000_000);
  });
});

describe('choosing slides', () => {
  it('starts with the first pages that have photos, up to the limit', () => {
    const p = book();
    const s = sheetOf(p);
    const pages = outputPages(p, 'page');
    expect([...firstNonEmpty(pages, s, 10)]).toEqual([slideKey(pages[1]!), slideKey(pages[2]!)]);
    expect([...firstNonEmpty(pages, s, 1)]).toEqual([slideKey(pages[1]!)]);
  });

  it('counts a photo on a page if any of it shows there', () => {
    const p = book();
    const [, left, right] = outputPages(p, 'page');
    expect(itemsOn(left!, sheetOf(p)).map((i) => i.photoId)).toEqual([A, B]);
    expect(itemsOn(right!, sheetOf(p)).map((i) => i.photoId)).toEqual([B]);
  });
});
