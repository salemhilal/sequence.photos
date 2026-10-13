import { describe, expect, it } from 'vitest';
import {
  feedRatio,
  fitsFeed,
  graphErrorMessage,
  hashtagCount,
  LIMITS,
  postImageLayout,
  ratioLabel,
} from './instagramPost';

describe('fitsFeed and feedRatio', () => {
  it('accepts 4:5 to 1.91:1 as is', () => {
    for (const [w, h] of [
      [1080, 1350],
      [1080, 1080],
      [1080, 566],
    ] as const) {
      expect(fitsFeed({ w, h }), `${w}x${h}`).toBe(true);
    }
  });

  it('takes taller frames to 4:5 and wider ones to 1.91:1', () => {
    expect(fitsFeed({ w: 1080, h: 1440 })).toBe(false);
    expect(feedRatio({ w: 1080, h: 1440 })).toBe(0.8);
    expect(feedRatio({ w: 3000, h: 1000 })).toBe(1.91);
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

describe('graphErrorMessage', () => {
  it('explains the errors people can act on', () => {
    expect(graphErrorMessage({ code: 190 }, 400)).toMatch(/Connect again/);
    expect(graphErrorMessage({ code: 4 }, 400)).toMatch(/limit/);
    expect(graphErrorMessage({ code: 9004 }, 400)).toMatch(/fetch the images/);
    expect(graphErrorMessage({ code: 36003 }, 400)).toMatch(/cropping or expanding/);
    expect(graphErrorMessage({ code: 1, error_user_msg: 'Try a smaller image.' }, 400)).toBe('Try a smaller image.');
    expect(graphErrorMessage(null, 500)).toMatch(/HTTP 500/);
  });
});
