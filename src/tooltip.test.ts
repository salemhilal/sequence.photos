import { describe, expect, it } from 'vitest';
import { placeTip } from './tooltip';

const view = { width: 800, height: 600 };
const tip = { width: 120, height: 30 };

describe('placeTip', () => {
  it('centers a tip below its element', () => {
    expect(placeTip({ left: 300, top: 100, width: 40, height: 20 }, tip, view)).toEqual({ left: 260, top: 126 });
  });

  it('stays inside the window near its left and right edges', () => {
    expect(placeTip({ left: 0, top: 100, width: 20, height: 20 }, tip, view).left).toBe(8);
    expect(placeTip({ left: 790, top: 100, width: 10, height: 20 }, tip, view).left).toBe(672);
  });

  it('goes above its element when there is no room below', () => {
    expect(placeTip({ left: 300, top: 560, width: 40, height: 20 }, tip, view).top).toBe(524);
  });
});
