import { describe, expect, it } from 'vitest';
import { addTestImages, FILM_COLORS, gradientColors } from './testImages';
import { ui } from './ui';

/** Each channel of a #rrggbb color, 0 to 255. */
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe('test images', () => {
  it('use film colors: never pure black or white, never gray', () => {
    for (const c of FILM_COLORS) {
      const [r, g, b] = channels(c) as [number, number, number];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      expect(max).toBeLessThan(250);
      expect(min).toBeGreaterThan(20);
      expect(max - min).toBeGreaterThan(40);
    }
  });

  it('pick two or three neighboring colors for each gradient', () => {
    let seed = 0;
    const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 50; i++) {
      const colors = gradientColors(random);
      expect(colors.length === 2 || colors.length === 3).toBe(true);
      expect(new Set(colors).size).toBe(colors.length);
      // Each next to the last on the wheel.
      const at = colors.map((c) => FILM_COLORS.indexOf(c as (typeof FILM_COLORS)[number]));
      for (let j = 1; j < at.length; j++) {
        const gap = Math.abs(at[j]! - at[j - 1]!);
        expect(gap === 1 || gap === FILM_COLORS.length - 1).toBe(true);
      }
    }
  });

  it('wait their turn: none are made while photos are being added', async () => {
    const importing = { done: 1, total: 4 };
    ui.set({ importing });
    await addTestImages(2);
    expect(ui.get().importing).toBe(importing);
    ui.set({ importing: null });
  });
});
