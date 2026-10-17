import { describe, expect, it } from 'vitest';
import type { ImageInfo } from './imageInfo';
import { orientationMatrix, passThrough, type Matrix } from './pdfImage';

const box = { x: 10, y: 20, w: 100, h: 200 };
const apply = ([a, b, c, d, e, f]: Matrix, p: number, q: number) => [a * p + c * q + e, b * p + d * q + f];
const corners = (m: Matrix) =>
  [apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)].map(([x, y]) => `${x},${y}`).sort();
const boxCorners = ['10,20', '10,220', '110,20', '110,220'];

describe('orientationMatrix', () => {
  it('draws an upright JPEG straight into the box', () => {
    expect(orientationMatrix(1, box)).toEqual([100, 0, 0, 200, 10, 20]);
  });

  it('turns a JPEG stored on its side (orientation 6) a quarter turn clockwise', () => {
    // The stored image's top-left corner (unit square's (0, 1)) shows at the box's top right.
    const m = orientationMatrix(6, box);
    expect(apply(m, 0, 1)).toEqual([110, 220]);
    // Its bottom-left (0, 0) shows at the top left.
    expect(apply(m, 0, 0)).toEqual([10, 220]);
  });

  it('turns a JPEG stored upside down (orientation 3) half a turn', () => {
    const m = orientationMatrix(3, box);
    expect(apply(m, 0, 1)).toEqual([110, 20]);
  });

  it('fills the box for every orientation, mirroring for 2, 4, 5, and 7', () => {
    for (let o = 1; o <= 8; o++) {
      const m = orientationMatrix(o, box);
      expect(corners(m)).toEqual(boxCorners);
      const det = m[0] * m[3] - m[1] * m[2];
      expect(det < 0, `orientation ${o}`).toBe([2, 4, 5, 7].includes(o));
    }
  });
});

describe('passThrough', () => {
  const jpeg: ImageInfo = { format: 'jpeg', ppi: 72, orientation: 1 };

  it('embeds a JPEG near the size needed as it is', () => {
    expect(passThrough(jpeg, { pxW: 3000 }, 3000)).toBe(true);
    expect(passThrough(jpeg, { pxW: 4400 }, 3000)).toBe(true);
    // Smaller than needed: it has no more to give, so as it is.
    expect(passThrough(jpeg, { pxW: 1000 }, 3000)).toBe(true);
  });

  it('resizes a JPEG far larger than needed, and anything that isn’t a JPEG', () => {
    expect(passThrough(jpeg, { pxW: 6000 }, 3000)).toBe(false);
    expect(passThrough({ ...jpeg, format: 'png' }, { pxW: 1000 }, 3000)).toBe(false);
    expect(passThrough({ ...jpeg, format: 'other' }, { pxW: 1000 }, 3000)).toBe(false);
  });
});
