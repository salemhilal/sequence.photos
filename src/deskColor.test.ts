import { describe, expect, it } from 'vitest';
import { DESK_PRESETS, luminance, savedDeskColor } from './deskColor';

describe('desk colors', () => {
  it('lists presets from darkest to lightest', () => {
    const l = DESK_PRESETS.map((p) => luminance(p.value));
    expect(l).toEqual([...l].sort((a, b) => a - b));
  });

  it('are neutral, from true black to true white', () => {
    for (const { value } of DESK_PRESETS) {
      const [r, g, b] = [1, 3, 5].map((i) => value.slice(i, i + 2));
      expect(r === g && g === b, value).toBe(true);
    }
    expect(DESK_PRESETS[0]!.value).toBe('#000000');
    expect(DESK_PRESETS.at(-1)!.value).toBe('#ffffff');
  });

  it('read an old, warm preset as its neutral one, and keep a custom color', () => {
    expect(savedDeskColor('#787876')).toBe('#787878');
    expect(savedDeskColor('#F4F3F0')).toBe('#ffffff');
    expect(savedDeskColor('#121211')).toBe('#000000');
    expect(savedDeskColor('#336699')).toBe('#336699');
    expect(savedDeskColor('teal')).toBeUndefined();
  });
});
