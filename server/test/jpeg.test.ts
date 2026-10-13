import { describe, expect, it } from 'vitest';
import { checkJpeg } from '../src/jpeg';
import { concat, makeJpeg, PNG } from './jpegs';

const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');

describe('checkJpeg', () => {
  it('accepts baseline, extended, and progressive JPEGs, and reads the dimensions', () => {
    expect(checkJpeg(makeJpeg())).toEqual({ ok: true, width: 1080, height: 1350 });
    expect(checkJpeg(makeJpeg({ sof: 0xc1 })).ok).toBe(true);
    expect(checkJpeg(makeJpeg({ sof: 0xc2, width: 1440, height: 1800 }))).toEqual({
      ok: true,
      width: 1440,
      height: 1800,
    });
    expect(checkJpeg(makeJpeg({ components: 1 })).ok).toBe(true);
  });

  it('skips fill bytes and standalone markers', () => {
    expect(checkJpeg(makeJpeg({ fill: 3 })).ok).toBe(true);
    expect(checkJpeg(makeJpeg({ tem: true })).ok).toBe(true);
  });

  it('refuses other start-of-frame types', () => {
    for (const sof of [0xc3, 0xc5, 0xc9, 0xca, 0xcf]) {
      expect(checkJpeg(makeJpeg({ sof }))).toEqual({ ok: false, reason: 'unsupported' });
    }
  });

  it('checks dimensions at the edges', () => {
    const dims = (width: number, height: number) => checkJpeg(makeJpeg({ width, height })).ok;
    expect(dims(320, 400)).toBe(true);
    expect(dims(319, 400)).toBe(false);
    expect(dims(1440, 400)).toBe(true);
    expect(dims(1441, 400)).toBe(false);
    expect(dims(1080, 2560)).toBe(true);
    expect(dims(1080, 2561)).toBe(false);
    expect(dims(1080, 1)).toBe(true);
    expect(dims(1080, 0)).toBe(false);
    expect(dims(65535, 65535)).toBe(false);
  });

  it('refuses truncated files', () => {
    const jpeg = makeJpeg();
    for (const length of [0, 1, 2, 3, 4, 10, 30, 100, 150, jpeg.length - 1]) {
      expect(checkJpeg(jpeg.slice(0, length)).ok).toBe(false);
    }
    // Cut inside the headers, then "fixed up" with an end marker. (A cut inside the scan
    // data, then fixed up, can't be told apart without decoding; Instagram would reject it.)
    for (const length of [10, 30, 100, 120, 140]) {
      expect(checkJpeg(concat(jpeg.slice(0, length), new Uint8Array([0xff, 0xd9]))).ok).toBe(false);
    }
  });

  it('refuses a JPEG with something appended (a polyglot)', () => {
    expect(checkJpeg(concat(makeJpeg(), html)).ok).toBe(false);
    expect(checkJpeg(concat(makeJpeg(), new Uint8Array([0]))).ok).toBe(false);
  });

  it('refuses other formats', () => {
    expect(checkJpeg(PNG).ok).toBe(false);
    expect(checkJpeg(html).ok).toBe(false);
    expect(checkJpeg(concat(new Uint8Array([0xff, 0xd8, 0xff]), html)).ok).toBe(false);
  });

  it('refuses broken structure', () => {
    const jpeg = makeJpeg();
    // A segment length running past the end.
    const overrun = jpeg.slice();
    overrun[5] = 0xff; // APP0 length low byte
    overrun[4] = 0xff; // APP0 length high byte
    expect(checkJpeg(overrun)).toEqual({ ok: false, reason: 'structure' });
    // A segment length below 2.
    const short = jpeg.slice();
    short[4] = 0;
    short[5] = 1;
    expect(checkJpeg(short)).toEqual({ ok: false, reason: 'structure' });
    // A non-marker where a marker should be.
    const garbage = jpeg.slice();
    garbage[2 + 18] = 0x00;
    expect(checkJpeg(garbage).ok).toBe(false);
    // A scan with no frame before it.
    const noFrame = new Uint8Array([
      0xff, 0xd8, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0xff, 0xd9,
    ]);
    expect(checkJpeg(noFrame).ok).toBe(false);
    // Two frames.
    const sofStart = 2 + 18 + 69;
    const sof = jpeg.slice(sofStart, sofStart + 19);
    expect(sof[1]).toBe(0xc0);
    expect(checkJpeg(concat(jpeg.slice(0, sofStart), sof, jpeg.slice(sofStart)))).toEqual({
      ok: false,
      reason: 'structure',
    });
    // A SOF whose length doesn't match its component count.
    const badSof = jpeg.slice();
    badSof[sofStart + 9] = 2;
    expect(checkJpeg(badSof).ok).toBe(false);
  });
});
