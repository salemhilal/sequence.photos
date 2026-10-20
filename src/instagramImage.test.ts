import { describe, expect, it } from 'vitest';
import { fits, hashtagCount, LIMITS, postImageLayout, ratioLabel, targetRatio } from './instagramImage';

describe('fits and targetRatio', () => {
  it('accepts 4:5 to 1.91:1 as is', () => {
    for (const [w, h] of [
      [1080, 1350],
      [1080, 1080],
      [1080, 566],
    ] as const) {
      expect(fits({ w, h }, 'feed'), `${w}x${h}`).toBe(true);
    }
  });

  it('takes taller frames to 4:5 and wider ones to 1.91:1', () => {
    expect(fits({ w: 1080, h: 1440 }, 'feed')).toBe(false);
    expect(targetRatio({ w: 1080, h: 1440 }, 'feed')).toBe(0.8);
    expect(targetRatio({ w: 3000, h: 1000 }, 'feed')).toBe(1.91);
  });

  it('takes any story shape but the very tallest', () => {
    expect(fits({ w: 1080, h: 1440 }, 'story')).toBe(true);
    expect(fits({ w: 4000, h: 300 }, 'story')).toBe(true);
    expect(fits({ w: 300, h: 3000 }, 'story')).toBe(false);
    expect(targetRatio({ w: 300, h: 3000 }, 'story')).toBe(LIMITS.minWidth / LIMITS.maxHeight);
  });
});

describe('postImageLayout', () => {
  it('leaves a frame that fits as it is', () => {
    expect(postImageLayout({ w: 1080, h: 1350 }, 'feed', 'crop')).toEqual({
      width: 1080,
      height: 1350,
      source: { x: 0, y: 0, w: 1080, h: 1350 },
      target: { x: 0, y: 0, w: 1080, h: 1350 },
    });
  });

  it('crops a 3:4 frame to 4:5 by trimming the top and bottom, centered', () => {
    const l = postImageLayout({ w: 1080, h: 1440 }, 'feed', 'crop');
    expect([l.width, l.height]).toEqual([1080, 1350]);
    expect(l.source).toEqual({ x: 0, y: 45, w: 1080, h: 1350 });
    expect(l.target).toEqual({ x: 0, y: 0, w: 1080, h: 1350 });
  });

  it('expands a 3:4 frame to 4:5 with margins at the sides', () => {
    const l = postImageLayout({ w: 1080, h: 1440 }, 'feed', 'expand');
    expect([l.width, l.height]).toEqual([1152, 1440]);
    expect(l.source).toEqual({ x: 0, y: 0, w: 1080, h: 1440 });
    expect(l.target).toEqual({ x: 36, y: 0, w: 1080, h: 1440 });
  });

  it('crops or expands a very wide frame to 1.91:1', () => {
    const crop = postImageLayout({ w: 1440, h: 400 }, 'feed', 'crop');
    expect(crop.width / crop.height).toBeCloseTo(1.91, 2);
    expect(crop.source.y).toBe(0);
    const expand = postImageLayout({ w: 1440, h: 400 }, 'feed', 'expand');
    expect(expand.width).toBe(1440);
    expect(expand.target.y).toBeGreaterThan(0);
  });

  it('keeps a story’s shape', () => {
    const l = postImageLayout({ w: 1080, h: 1440 }, 'story', 'crop');
    expect([l.width, l.height]).toEqual([1080, 1440]);
  });

  it('scales to Instagram’s widths and the server’s height limit', () => {
    const big = postImageLayout({ w: 4000, h: 5000 }, 'feed', 'crop');
    expect(big.width).toBe(LIMITS.maxWidth);
    expect(big.target.w).toBe(LIMITS.maxWidth);
    const small = postImageLayout({ w: 200, h: 250 }, 'feed', 'crop');
    expect(small.width).toBe(LIMITS.minWidth);
    const tall = postImageLayout({ w: 1080, h: 4000 }, 'story', 'crop');
    expect(tall.height).toBeLessThanOrEqual(LIMITS.maxHeight);
  });

  it('crops or expands very tall stories to what the server takes', () => {
    for (const fit of ['crop', 'expand'] as const) {
      const l = postImageLayout({ w: 300, h: 3000 }, 'story', fit);
      expect(l.width, fit).toBeGreaterThanOrEqual(LIMITS.minWidth);
      expect(l.height, fit).toBeLessThanOrEqual(LIMITS.maxHeight);
    }
  });

  it('never rounds a feed image past 4:5 or 1.91:1', () => {
    for (let w = 900; w <= 1100; w++) {
      for (const size of [
        { w, h: Math.round(w * 1.25) + 1 },
        { w: Math.round(w * 1.91) + 1, h: w },
      ]) {
        for (const fit of ['crop', 'expand'] as const) {
          const l = postImageLayout(size, 'feed', fit);
          const r = l.width / l.height;
          expect(r, `${size.w}x${size.h} ${fit}`).toBeGreaterThanOrEqual(LIMITS.minRatio);
          expect(r, `${size.w}x${size.h} ${fit}`).toBeLessThanOrEqual(LIMITS.maxRatio);
        }
      }
    }
  });
});

describe('ratioLabel', () => {
  it('names common ratios, and others to two places', () => {
    expect(ratioLabel(0.8)).toBe('4:5');
    expect(ratioLabel(0.75)).toBe('3:4');
    expect(ratioLabel(1.91)).toBe('1.91:1');
  });
});

describe('hashtagCount', () => {
  it('counts hashtags, not # inside words', () => {
    expect(hashtagCount('#film shot on #35mm, issue#3 #')).toBe(2);
    expect(hashtagCount('#été #写真')).toBe(2);
  });
});
