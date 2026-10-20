import { describe, expect, it } from 'vitest';
import { clamp, wheeled, zoomedAround } from './deskZoom';

const view = { zoom: 1, panX: 100, panY: 50 };
const scroll = (deltaX: number, deltaY: number, mod = false) => ({ deltaX, deltaY, ctrlKey: mod, metaKey: false });

describe('zoomedAround', () => {
  it('keeps the point under the pointer still', () => {
    const v = zoomedAround(view, 2, 300, 250);
    // The world point under (300, 250) before: ((300 − 100) / 1, (250 − 50) / 1) = (200, 200).
    expect(v).toEqual({ zoom: 2, panX: 300 - 200 * 2, panY: 250 - 200 * 2 });
  });
});

describe('wheeled', () => {
  it('pans with plain scrolling', () => {
    expect(wheeled(view, scroll(10, -20), 0, 0)).toEqual({ zoom: 1, panX: 90, panY: 70 });
  });

  it('zooms around the pointer with a pinch or ⌘-scroll, in and out', () => {
    const zoomedIn = wheeled(view, scroll(0, -50, true), 300, 250);
    expect(zoomedIn.zoom).toBeCloseTo(Math.exp(0.5));
    // The point under the pointer stays put.
    expect((300 - zoomedIn.panX) / zoomedIn.zoom).toBeCloseTo(200);
    expect(wheeled(view, { ...scroll(0, 50), metaKey: true }, 0, 0).zoom).toBeLessThan(1);
  });

  it('holds the zoom between its limits', () => {
    expect(wheeled(view, scroll(0, -10_000, true), 0, 0, 0.5, 8).zoom).toBe(8);
    expect(wheeled(view, scroll(0, 10_000, true), 0, 0, 0.5, 8).zoom).toBe(0.5);
  });
});

describe('clamp', () => {
  it('holds a number between two others', () => {
    expect([clamp(-1, 0, 1), clamp(0.5, 0, 1), clamp(2, 0, 1)]).toEqual([0, 0.5, 1]);
  });
});
