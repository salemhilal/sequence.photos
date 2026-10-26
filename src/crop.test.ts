import { describe, expect, it } from 'vitest';
import { cleanCrop, cropFrom, cropPixels, cropStyle, cropToRatio, isWhole, visibleSize, wholeRect } from './crop';
import { fitCentered, pileSize } from './geometry';
import { planPage } from './renderPlan';
import { coverage } from './resolution';
import { toPhotoId, toSpreadId } from './ids';
import type { PhotoMeta, Sheet } from './types';

const photo = (crop?: PhotoMeta['crop']): PhotoMeta => ({
  id: toPhotoId('a'),
  name: 'a.jpg',
  pxW: 4000,
  pxH: 3000,
  ...(crop && { crop }),
});
const half = { x: 0.25, y: 0, w: 0.5, h: 1 };

describe('crops', () => {
  it('show part of the photo: its pixels, and its shape', () => {
    expect(visibleSize(photo(half))).toEqual({ pxW: 2000, pxH: 3000 });
    expect(cropPixels(photo(half))).toEqual({ x: 1000, y: 0, w: 2000, h: 3000 });
    expect(visibleSize(photo())).toEqual({ pxW: 4000, pxH: 3000 });
  });

  it('are kept inside the photo, not too small, and none when they’re the whole', () => {
    expect(cleanCrop({ x: -0.1, y: 0.5, w: 0.5, h: 0.8 })).toEqual({ x: 0, y: 0.2, w: 0.5, h: 0.8 });
    expect(cleanCrop({ x: 0.5, y: 0.5, w: 0, h: 0 })?.w).toBe(0.02);
    expect(cleanCrop({ x: 0, y: 0, w: 1, h: 1 })).toBeUndefined();
    expect(isWhole(undefined)).toBe(true);
  });

  it('go back and forth between a frame and the whole photo behind it', () => {
    const frame = { x: 10, y: 20, w: 5, h: 7.5 };
    const whole = wholeRect(frame, half);
    expect(whole).toEqual({ x: 7.5, y: 20, w: 10, h: 7.5 });
    expect(cropFrom(frame, whole)).toEqual(half);
  });

  it('crop to a shape, as large as fits, centered on what shows', () => {
    expect(cropToRatio(photo(), 1)).toEqual({ x: 0.125, y: 0, w: 0.75, h: 1 });
    // From a crop at the left, the square stays as far left as it can.
    expect(cropToRatio(photo({ x: 0, y: 0, w: 0.3, h: 1 }), 1)?.x).toBe(0);
    expect(cropToRatio(photo(), 4000 / 3000)).toBeUndefined();
  });

  it('place the original so the frame shows the crop', () => {
    expect(cropStyle(half)).toMatchObject({ left: '-50%', top: '0%', width: '200%', height: '100%' });
    expect(cropStyle(undefined)).toBeUndefined();
  });

  it('give fitting, the desk, and resolution the cropped shape and pixels', () => {
    const p = photo(half);
    const fit = fitCentered(p, { x: 0, y: 0, w: 10, h: 10 });
    expect(fit.w / fit.h).toBeCloseTo(2 / 3);
    const pile = pileSize(p);
    expect(pile.w / pile.h).toBeCloseTo(2 / 3);
    expect(coverage(p, { w: 2, h: 3 }, 1000)).toBe(1);
    expect(coverage(photo(), { w: 2, h: 3 }, 1000)).toBe(1);
  });

  it('export only what shows: the crop’s pixels, offset into the original', () => {
    const sheet: Sheet = {
      arrangement: 'frames',
      unit: 'px',
      pxPerUnit: 1,
      pageW: 200,
      pageH: 300,
      centerV: false,
      centerH: false,
      keepRelative: true,
      borders: [],
      lines: [],
      dropBorder: null,
    };
    const a = toPhotoId('a');
    const plan = planPage(
      {
        spread: { kind: 'frame', id: toSpreadId('f'), items: [{ photoId: a, x: 0, y: 0, w: 200, h: 300, z: 1 }] },
        part: 'whole',
      },
      sheet,
      { [a]: photo(half) },
    );
    expect(plan.draws[0]?.src).toEqual({ x: 1000, y: 0, w: 2000, h: 3000 });
  });
});
