import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { toPhotoId } from '../ids';
import type { PhotoMeta, Project } from '../types';
import { validateProject } from '../validate';
import {
  addPhotos,
  centerPhoto,
  copyFrames,
  deskPhotos,
  fitPhoto,
  framesOf,
  outerRect,
  placeAt,
  setBackground,
  setBorder,
  snapPhoto,
  toDesk,
} from './frameActions';
import { newSequence } from './library';

const A = toPhotoId('a');
const B = toPhotoId('b');
const C = toPhotoId('c');
/** Portrait photos, 2:3. */
const photo = (id: typeof A): PhotoMeta => ({ id, name: `${id}.jpg`, pxW: 800, pxH: 1200 });

/** A 1080 × 1350 sequence with one empty frame and a 54 px border guide. */
const seq = () => newSequence();
const apply = (p: Project, recipe: (d: import('immer').Draft<Project>) => void) => produce(p, recipe);

describe('addPhotos', () => {
  it('gives each photo a frame of its own, after the empty one', () => {
    const p = apply(seq(), (d) => addPhotos(d, [photo(A), photo(B)], 'frames'));
    const frames = framesOf(p);
    expect(frames.map((f) => f.items.map((i) => i.photoId))).toEqual([[], [A], [B]]);
    expect(() => validateProject(p)).not.toThrow();
  });

  it('fills the empty frames first', () => {
    const p = apply(seq(), (d) => addPhotos(d, [photo(A), photo(B)], 'fill'));
    expect(framesOf(p).map((f) => f.items.map((i) => i.photoId))).toEqual([[A], [B]]);
  });

  it('fits each inside the drop guide, centered', () => {
    const p = apply(seq(), (d) => addPhotos(d, [photo(A)], 'fill'));
    const item = framesOf(p)[0]!.items[0]!;
    // 54 px in from the top and bottom: 1242 px tall, 828 wide, centered across 1080.
    expect(item).toMatchObject({ y: 54, h: 1242, w: 828, x: 126 });
  });

  it('puts them on the desk, in the order they came', () => {
    const p = apply(seq(), (d) => addPhotos(d, [photo(A), photo(B), photo(C)], 'desk'));
    expect(deskPhotos(p)).toEqual([A, B, C]);
    expect(framesOf(p)[0]!.items).toEqual([]);
  });
});

describe('placeAt and toDesk', () => {
  it('moves a desk photo onto a frame, centered where it was dropped', () => {
    const desk = apply(seq(), (d) => addPhotos(d, [photo(A)], 'desk'));
    const id = framesOf(desk)[0]!.id;
    const p = apply(desk, (d) => placeAt(d, A, id, { x: 300, y: 400 }));
    const item = framesOf(p)[0]!.items[0]!;
    expect(item.x + item.w / 2).toBeCloseTo(300);
    expect(item.y + item.h / 2).toBeCloseTo(400);
    expect(p.pile).toEqual([]);
    expect(() => validateProject(p)).not.toThrow();
  });

  it('keeps the drop point on the frame', () => {
    const desk = apply(seq(), (d) => addPhotos(d, [photo(A)], 'desk'));
    const p = apply(desk, (d) => placeAt(d, A, framesOf(d)[0]!.id, { x: -500, y: 99999 }));
    const item = framesOf(p)[0]!.items[0]!;
    expect(item.x + item.w / 2).toBe(0);
    expect(item.y + item.h / 2).toBe(1350);
  });

  it('takes a placed photo back to the desk', () => {
    const placed = apply(seq(), (d) => addPhotos(d, [photo(A)], 'fill'));
    const p = apply(placed, (d) => toDesk(d, A));
    expect(framesOf(p)[0]!.items).toEqual([]);
    expect(deskPhotos(p)).toEqual([A]);
  });
});

describe('backgrounds and borders', () => {
  it('sets a background, and white takes it off', () => {
    const p = apply(seq(), (d) => setBackground(d, [framesOf(d)[0]!.id], 'black'));
    expect(framesOf(p)[0]!.background).toBe('black');
    const back = apply(p, (d) => setBackground(d, [framesOf(d)[0]!.id], 'white'));
    expect(framesOf(back)[0]).not.toHaveProperty('background');
  });

  it('sets a border, and none (or zero) takes it off', () => {
    const placed = apply(seq(), (d) => addPhotos(d, [photo(A)], 'fill'));
    const p = apply(placed, (d) => setBorder(d, A, { width: 12, color: 'black' }));
    expect(framesOf(p)[0]!.items[0]!.border).toEqual({ width: 12, color: 'black' });
    expect(framesOf(apply(p, (d) => setBorder(d, A, { width: 0, color: 'black' })))[0]!.items[0]).not.toHaveProperty(
      'border',
    );
  });

  it('snaps a bordered photo by its outer edge', () => {
    const border = { width: 10, color: 'white' as const };
    const r = { x: 25, y: 300, w: 400, h: 600 };
    expect(outerRect(r, border)).toEqual({ x: 15, y: 290, w: 420, h: 620 });
    // Its border's edge (15) snaps to the frame's (0): the photo lands 10 in.
    const { rect } = snapPhoto(r, border, { xs: [0], ys: [] }, 20);
    expect(rect.x).toBe(10);
  });

  it('fits a bordered photo, border and all, inside the box', () => {
    const placed = apply(seq(), (d) => {
      addPhotos(d, [photo(A)], 'fill');
      setBorder(d, A, { width: 20, color: 'black' });
    });
    const p = apply(placed, (d) => fitPhoto(d, A, { x: 0, y: 0, w: 1080, h: 1350 }));
    const item = framesOf(p)[0]!.items[0]!;
    expect(item.y).toBe(20);
    expect(item.h).toBe(1310);
  });
});

describe('centerPhoto', () => {
  it('centers a photo on its frame', () => {
    const placed = apply(seq(), (d) => {
      addPhotos(d, [photo(A)], 'fill');
      const item = framesOf(d)[0]!.items[0]!;
      item.x = 0;
      item.y = 0;
    });
    const item = framesOf(apply(placed, (d) => centerPhoto(d, A)))[0]!.items[0]!;
    expect(item.x + item.w / 2).toBe(540);
    expect(item.y + item.h / 2).toBe(675);
  });
});

describe('copyFrames', () => {
  it('puts each copy after its original, with copies of its photos', () => {
    const p0 = apply(seq(), (d) => {
      addPhotos(d, [photo(A), photo(B)], 'fill');
      setBackground(d, [framesOf(d)[1]!.id], 'black');
    });
    const [f1, f2] = framesOf(p0);
    const copies = [
      { from: A, id: toPhotoId('a2') },
      { from: B, id: toPhotoId('b2') },
    ];
    const p = apply(p0, (d) => void copyFrames(d, [f1!.id, f2!.id], copies));
    const frames = framesOf(p);
    expect(frames.map((f) => f.items.map((i) => i.photoId))).toEqual([[A], ['a2'], [B], ['b2']]);
    expect(frames[3]!.background).toBe('black');
    expect(p.photos[toPhotoId('a2')]?.name).toBe('a copy.jpg');
    expect(() => validateProject(p)).not.toThrow();
  });
});
