import type { CSSProperties } from 'react';
import type { PageSetup, Placement } from '../types';
import { outerRect } from './frameActions';

/** Where things go on the phone's screens: pure, for the components to share. */

/** A placed photo's box on a frame drawn `scale` screen pixels per unit, border included as a shadow. */
export function itemStyle(item: Placement, scale: number): CSSProperties {
  const b = item.border;
  return {
    left: item.x * scale,
    top: item.y * scale,
    width: item.w * scale,
    height: item.h * scale,
    zIndex: item.z,
    ...(b ? { boxShadow: `0 0 0 ${b.width * scale}px ${b.color === 'black' ? '#000' : '#fff'}` } : {}),
  };
}

/** A frame's width that fits a box, keeping its shape. */
export function fitWidth(page: Pick<PageSetup, 'w' | 'h'>, box: { w: number; h: number }): number {
  return Math.min(box.w, (box.h * page.w) / page.h);
}

/** The topmost placed photo under a point (in the frame's units), border and all. */
export function photoAt(items: readonly Placement[], x: number, y: number): Placement | undefined {
  return [...items]
    .sort((a, b) => b.z - a.z)
    .find((i) => {
      const r = outerRect(i, i.border);
      return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    });
}

/**
 * Where a photo's warning mark goes on a frame drawn `scale` screen pixels per unit: inside its
 * top-right corner, kept on the frame where the photo hangs off it. `size` is the mark's side.
 */
export function markAt(
  item: Pick<Placement, 'x' | 'y' | 'w'>,
  page: Pick<PageSetup, 'w'>,
  scale: number,
  size: number,
): { left: number; top: number } {
  const inset = size / 4;
  return {
    left: Math.max(0, Math.min(item.x + item.w, page.w) * scale - size - inset),
    top: Math.max(0, item.y) * scale + inset,
  };
}
