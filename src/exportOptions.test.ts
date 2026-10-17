import { describe, expect, it } from 'vitest';
import { converts, defaultOptions, exportPxPerUnit, perOf } from './exportOptions';
import { rearrange } from './convertLayout';
import { emptyProject } from './store';

const inches = { arrangement: 'spreads', unit: 'in', pxPerUnit: 300 } as const;
const pixels = { arrangement: 'frames', unit: 'px', pxPerUnit: 1 } as const;

describe('export options', () => {
  it('start per spread for spreads, at the page’s resolution, printing pixels at 300', () => {
    expect(defaultOptions(inches)).toEqual({ per: 'spread', format: 'jpeg', dpi: null, printAt: 300 });
    expect(defaultOptions(pixels)).toMatchObject({ per: 'page', dpi: null });
    // Null follows the page: its dpi in inches, one a pixel in pixels.
    expect(exportPxPerUnit('images', inches, defaultOptions(inches))).toBe(300);
    expect(exportPxPerUnit('images', pixels, defaultOptions(pixels))).toBe(1);
  });

  it('convert only where the destination measures differently', () => {
    expect(converts('pdf', inches)).toBe(false);
    expect(converts('images', inches)).toBe(true);
    expect(converts('instagram', inches)).toBe(true);
    expect(converts('pdf', pixels)).toBe(true);
    expect(converts('images', pixels)).toBe(false);
    expect(converts('indesign', pixels)).toBe(false);
  });

  it('export inches at the chosen dpi, never above the page’s; pixels one each', () => {
    const o = defaultOptions(inches);
    expect(exportPxPerUnit('images', inches, { ...o, dpi: 150 })).toBe(150);
    expect(exportPxPerUnit('pdf', inches, { ...o, dpi: 600 })).toBe(300);
    expect(exportPxPerUnit('images', pixels, { ...o, dpi: 150 })).toBe(1);
  });

  it('make frames per page whatever was asked', () => {
    expect(perOf(rearrange(emptyProject(), 'frames'), { per: 'spread' })).toBe('page');
    expect(perOf(emptyProject(), { per: 'spread' })).toBe('spread');
  });
});
