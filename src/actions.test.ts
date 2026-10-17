import { beforeEach, describe, expect, it } from 'vitest';
import { produce } from 'immer';
import {
  freeSpot,
  addPhotosToPile,
  folioLabel,
  deleteFromProject,
  deleteSpread,
  dropPhotos,
  insertSpread,
  locate,
  moveSpread,
  putInPile,
  putOnNewSpread,
  raise,
  putOnPage,
  spreadLabel,
  tidyPile,
} from './actions';
import { toPhotoId } from './ids';
import { applyPageSetup, draftOf } from './pageSetup';
import { DESK_PPI, deskGeometry } from './deskGeometry';
import { DESK_PHOTO_PX } from './geometry';
import { allSpreads } from './spreads';
import { ui } from './ui';
import { projectStore, emptyProject } from './store';
import type { PhotoMeta } from './types';

const LAND = toPhotoId('land');
const PORT = toPhotoId('port');
const SQ = toPhotoId('sq');
const photos: PhotoMeta[] = [
  { id: LAND, name: 'land.jpg', pxW: 1800, pxH: 1000 },
  { id: PORT, name: 'port.jpg', pxW: 800, pxH: 1000 },
  { id: SQ, name: 'sq.jpg', pxW: 1000, pxH: 1000 },
];
const project = () => projectStore.project;
/** The whole book, in order: first, middles, last. */
const book = () => allSpreads(project());
/** A middle spread by its place in the book (1 is the first middle one). */
const middle = (i = 1) => {
  const s = book()[i];
  if (!s || s.kind !== 'middle') throw new Error(`no middle spread at ${i}`);
  return s;
};

beforeEach(() => {
  projectStore.reset(emptyProject());
  addPhotosToPile(photos);
});

describe('adding photos', () => {
  it('places new photos at full size: as large as their preview stays sharp at 100%', () => {
    expect(project().pile).toHaveLength(3);
    const land = project().pile.find((p) => p.photoId === LAND);
    expect(land?.w).toBeCloseTo(DESK_PHOTO_PX / DESK_PPI);
    expect(land?.h).toBeCloseTo(DESK_PHOTO_PX / DESK_PPI / 1.8);
  });

  it('places photos smaller than the preview at their own size', () => {
    addPhotosToPile([{ id: toPhotoId('small'), name: 'small.jpg', pxW: 480, pxH: 240 }]);
    expect(project().pile.find((p) => p.photoId === 'small')).toMatchObject({ w: 10, h: 5 });
  });

  it('lays a batch out in rows of six, and zooms the view to fit it', () => {
    projectStore.reset(emptyProject());
    const batch = Array.from({ length: 8 }, (_, i) => ({
      id: toPhotoId(`b${i}`),
      name: `b${i}.jpg`,
      pxW: 1000,
      pxH: 1000,
    }));
    ui.set({ view: { panX: 0, panY: 0, zoom: 1 } });
    addPhotosToPile(batch);
    const rows = new Set(project().pile.map((p) => Math.round(p.y)));
    expect(rows.size).toBe(2);
    expect(project().pile.filter((p) => Math.round(p.y) === Math.min(...rows))).toHaveLength(6);
    expect(ui.get().view.zoom).toBeLessThan(1);
  });

  it('adds later batches below the existing pile', () => {
    const bottom = Math.max(...project().pile.map((p) => p.y + p.h));
    addPhotosToPile([{ id: toPhotoId('late'), name: 'late.jpg', pxW: 1000, pxH: 1000 }]);
    expect(project().pile.find((p) => p.photoId === 'late')?.y).toBeGreaterThan(bottom);
  });
});

describe('putOnPage', () => {
  it('moves a photo from the pile to a page, fit to the largest border guide and centered', () => {
    projectStore.apply((d) => putOnPage(d, [PORT], middle().id, 'right'));
    expect(project().pile.map((p) => p.photoId)).not.toContain(PORT);
    const item = middle().items[0];
    expect(item).toMatchObject({ photoId: PORT, y: 0.5, h: 7 });
    expect(item!.x + item!.w / 2).toBeCloseTo(5);
  });

  it('centers left-page photos on the left page', () => {
    projectStore.apply((d) => putOnPage(d, [SQ], middle().id, 'left'));
    const item = middle().items[0]!;
    expect(item.x + item.w / 2).toBeCloseTo(-5);
  });

  it('adds a spread and places photos on its left page when dropped between spreads', () => {
    projectStore.apply((d) => putOnPage(d, [SQ], middle(1).id, 'right'));
    projectStore.apply((d) => putOnNewSpread(d, [SQ, LAND], 2));
    expect(book()).toHaveLength(5);
    const added = book()[2]!;
    expect(added.kind).toBe('middle');
    expect(added.items.map((i) => i.photoId)).toEqual([SQ, LAND]);
    expect(added.items.every((i) => i.x + i.w / 2 < 0)).toBe(true);
    expect(middle(1).items).toHaveLength(0);
  });

  it('never adds a spread before the first page or after the last', () => {
    projectStore.apply((d) => putOnNewSpread(d, [SQ], 0));
    expect(book()[0]!.kind).toBe('first');
    expect(book()[1]!.items.map((i) => i.photoId)).toEqual([SQ]);
  });

  it('moves a photo between spreads without duplicating it', () => {
    projectStore.apply((d) => putOnPage(d, [SQ], middle(1).id, 'left'));
    projectStore.apply((d) => putOnPage(d, [SQ], middle(2).id, 'right'));
    expect(middle(1).items).toHaveLength(0);
    expect(middle(2).items.map((i) => i.photoId)).toEqual([SQ]);
  });

  it('puts the most recently placed photo on top', () => {
    projectStore.apply((d) => putOnPage(d, [SQ, LAND], middle().id, 'right'));
    const [a, b] = middle().items;
    expect(b!.z).toBeGreaterThan(a!.z);
  });
});

describe('putInPile', () => {
  it('returns a photo to the desk at pile size, centered on a point', () => {
    projectStore.apply((d) => putOnPage(d, [SQ], middle().id, 'right'));
    projectStore.apply((d) => putInPile(d, SQ, { x: 10, y: 10 }));
    expect(middle().items).toHaveLength(0);
    const side = 1000 / DESK_PPI;
    expect(project().pile.find((p) => p.photoId === SQ)).toMatchObject({
      x: 10 - side / 2,
      y: 10 - side / 2,
      w: side,
      h: side,
    });
  });
});

describe('spreads', () => {
  it('labels pages with single first and last pages', () => {
    expect([0, 1, 2, 3].map((i) => spreadLabel(i, 4, 'spreads'))).toEqual(['1', '2–3', '4–5', '6']);
  });

  it('pads folio labels like page numbers in a book', () => {
    expect([0, 1, 3].map((i) => folioLabel(i, 4, 'spreads'))).toEqual(['01', '02–03', '06']);
    expect(folioLabel(1, 60, 'spreads')).toBe('002–003');
  });

  it('inserts spreads between the fixed first and last pages', () => {
    insertSpread(0);
    expect(book()[0]!.kind).toBe('first');
    expect(book()[1]!.kind).toBe('middle');
    insertSpread(99);
    expect(book().at(-1)!.kind).toBe('last');
    expect(book()).toHaveLength(6);
  });

  it('never deletes the first or last page', () => {
    deleteSpread(allSpreads(project())[0]!.id);
    deleteSpread(allSpreads(project()).at(-1)!.id);
    expect(book()).toHaveLength(4);
  });

  it('returns photos to the desk when their spread is deleted', () => {
    projectStore.apply((d) => putOnPage(d, [SQ, LAND], middle().id, 'right'));
    deleteSpread(middle().id);
    expect(book()).toHaveLength(3);
    expect(
      project()
        .pile.map((p) => p.photoId)
        .sort(),
    ).toEqual([LAND, PORT, SQ]);
  });

  it('reorders middle spreads but keeps first and last in place', () => {
    const [first, a, b, last] = book().map((s) => s.id);
    moveSpread(a!, 2);
    expect(book().map((s) => s.id)).toEqual([first, b, a, last]);
    moveSpread(a!, 0);
    expect(book()[0]!.id).toBe(first);
    moveSpread(first!, 2);
    expect(book()[0]!.id).toBe(first);
  });
});

describe('deleteFromProject', () => {
  it('removes photos everywhere, undoably', () => {
    projectStore.apply((d) => putOnPage(d, [SQ], middle().id, 'right'));
    deleteFromProject([SQ, LAND]);
    expect(Object.keys(project().photos)).toEqual([PORT]);
    expect(middle().items).toHaveLength(0);
    projectStore.undo();
    expect(Object.keys(project().photos)).toHaveLength(3);
  });
});

describe('tidyPile', () => {
  const place = (id: PhotoMeta['id'], x: number, y: number) =>
    projectStore.apply((d) => {
      const p = d.pile.find((q) => q.photoId === id)!;
      p.x = x;
      p.y = y;
    });

  it('lines photos up on a grid, keeping their reading order', () => {
    // Positions for 2" photos, scaled to these full-size ones.
    const k = DESK_PHOTO_PX / DESK_PPI / 2;
    place(LAND, 5.2 * k, 0.9 * k);
    place(PORT, 0.3 * k, 1.2 * k);
    place(SQ, 2.6 * k, 4.4 * k);
    // A view zoomed out enough for two of these side by side.
    const visible = deskGeometry.visible;
    deskGeometry.visible = () => ({ x: 0, y: 0, w: 20 * k, h: 12 * k });
    tidyPile();
    deskGeometry.visible = visible;
    const byId = Object.fromEntries(project().pile.map((p) => [p.photoId, p]));
    // Row 1: port, land (left to right); row 2: sq.
    expect(byId.port!.y).toBeLessThan(byId.sq!.y);
    expect(byId.port!.x).toBeLessThan(byId.land!.x);
    const centerY = (id: string) => byId[id]!.y + byId[id]!.h / 2;
    expect(centerY(PORT)).toBeCloseTo(centerY(LAND));
    // Grid cells are the largest photo plus a gap in proportion.
    const centerX = (id: string) => byId[id]!.x + byId[id]!.w / 2;
    expect(centerX(LAND) - centerX(PORT)).toBeCloseTo((DESK_PHOTO_PX / DESK_PPI) * 1.08);
    expect(centerX(SQ)).toBeCloseTo(centerX(PORT));
  });

  it('wraps rows that are wider than the visible desk', () => {
    // 96 px photos are 2" on the desk.
    const extra = Array.from({ length: 12 }, (_, i) => ({
      id: toPhotoId(`x${i}`),
      name: `x${i}.jpg`,
      pxW: 96,
      pxH: 96,
    }));
    addPhotosToPile(extra);
    const ids = extra.map((p) => p.id);
    ids.forEach((id, i) => place(id, i * 2.5, 1));
    tidyPile(ids);
    // The default visible desk is 20" wide: 9 columns of 2.16" cells.
    const rows = new Set(
      project()
        .pile.filter((p) => ids.includes(p.photoId))
        .map((p) => Math.round(p.y + p.h / 2)),
    );
    expect(rows.size).toBe(2);
  });

  it('only tidies the selection when several photos are selected', () => {
    const before = project().pile.find((p) => p.photoId === SQ);
    tidyPile([LAND, PORT]);
    expect(project().pile.find((p) => p.photoId === SQ)).toEqual(before);
  });

  it('is one undoable step', () => {
    const before = project().pile;
    tidyPile();
    projectStore.undo();
    expect(project().pile).toEqual(before);
  });
});

describe('locate', () => {
  it('finds photos on the desk or on a spread', () => {
    projectStore.apply((d) => putOnPage(d, [SQ], middle().id, 'right'));
    expect(locate(project(), LAND)?.where).toBe('desk');
    const onSpread = locate(project(), SQ);
    expect(onSpread?.where === 'spread' && onSpread.spread.id).toBe(middle().id);
    expect(locate(project(), toPhotoId('nope'))).toBeNull();
  });
});

describe('dropPhotos', () => {
  it('places photos on pages, in new spreads, or back on the desk', () => {
    projectStore.apply((d) => void dropPhotos(d, { kind: 'page', spreadId: middle().id, side: 'left' }, [SQ]));
    expect(locate(project(), SQ)?.where).toBe('spread');
    projectStore.apply((d) => void dropPhotos(d, { kind: 'insert', index: 1 }, [LAND]));
    expect(book()).toHaveLength(5);
    expect(book()[1]!.items.map((i) => i.photoId)).toEqual([LAND]);
    projectStore.apply((d) => void dropPhotos(d, { kind: 'desk' }, [SQ], { x: 10, y: 10 }));
    const half = 1000 / DESK_PPI / 2;
    expect(project().pile.find((p) => p.photoId === SQ)).toMatchObject({ x: 10 - half, y: 10 - half });
  });

  it('does nothing without a target', () => {
    const before = project();
    projectStore.apply((d) => void dropPhotos(d, null, [SQ]));
    expect(project()).toBe(before);
  });
});

describe('raise', () => {
  it('brings a photo to the front, and leaves the one already there alone', () => {
    const project = produce(sampleProjectForRaise(), (d) => {
      raise(d, d.pile, d.pile[0]!);
    });
    expect(project.pile[0]!.z).toBe(3);
    const again = produce(project, (d) => {
      raise(d, d.pile, d.pile[0]!);
    });
    // Unchanged, so a click on the front photo isn't an edit.
    expect(again).toBe(project);
  });
});

function sampleProjectForRaise() {
  const project = emptyProject();
  project.pile = [
    { photoId: toPhotoId('a'), x: 0, y: 0, w: 1, h: 1, z: 1 },
    { photoId: toPhotoId('b'), x: 0, y: 0, w: 1, h: 1, z: 2 },
  ];
  project.nextZ = 3;
  return project;
}

describe('frames', () => {
  beforeEach(() => {
    projectStore.reset(emptyProject());
    applyPageSetup({
      ...draftOf(projectStore.project),
      arrangement: 'frames',
      page: { w: 1080, h: 1350, unit: 'px', pxPerUnit: 1 },
    });
    addPhotosToPile(photos);
  });

  it('adds a frame anywhere, even first or last', () => {
    const first = book()[0]!.id;
    insertSpread(0);
    expect(book()[1]!.id).toBe(first);
    insertSpread(99);
    expect(book()).toHaveLength(8);
    expect(book().every((s) => s.kind === 'frame')).toBe(true);
  });

  it('moves any frame, and deletes any but the last one left', () => {
    const ids = book().map((s) => s.id);
    moveSpread(ids[0]!, 5);
    expect(book().at(-1)!.id).toBe(ids[0]);
    for (const id of ids) deleteSpread(id);
    expect(book()).toHaveLength(1);
  });

  it('puts photos on the whole frame, fit inside the guide', () => {
    const id = book()[2]!.id;
    projectStore.apply((d) => putOnPage(d, [SQ], id, 'whole'));
    const [p] = book()[2]!.items;
    // 1080 px wide, inside the 54 px guide.
    expect(p).toMatchObject({ x: 54, w: 972, h: 972 });
  });

  it('numbers frames one by one', () => {
    expect(spreadLabel(4, 6, 'frames')).toBe('5');
    expect(folioLabel(4, 6, 'frames')).toBe('05');
  });
});

describe('freeSpot', () => {
  const size = { w: 2, h: 3 };

  it('is the spot asked for on an empty desk', () => {
    expect(freeSpot([], size, { x: 10, y: 10 })).toEqual({ x: 9, y: 8.5 });
  });

  it('is the nearest spot clear of other photos', async () => {
    const pile = [{ x: 8, y: 8, w: 4, h: 4 }];
    const spot = freeSpot(pile, size, { x: 10, y: 10 });
    const overlaps = (a: (typeof pile)[number], b: (typeof pile)[number]) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(overlaps({ ...spot, ...size }, pile[0]!)).toBe(false);
    // Next to it, not far away.
    expect(Math.hypot(spot.x - 9, spot.y - 8.5)).toBeLessThan(5);
  });
});
