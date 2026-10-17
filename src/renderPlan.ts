import { intersects, pageRect, pageSides, spreadLeft, spreadWidth, type Rect } from './geometry';
import type { PhotoId } from './ids';
import { allSpreads } from './spreads';
import type { PageSide, PhotoMeta, Project, Sheet, Spread } from './types';

/**
 * What exports draw, worked out apart from drawing it. A plan says, for one output image,
 * which part of each photo shows and where it goes, in output pixels: the page's units
 * times its pxPerUnit. Every renderer (images, PDF, Instagram) draws from a plan, so they
 * agree, and none needs to know the page's unit.
 */

/** One image an export makes: a whole spread, one page of it, or a frame. */
export interface OutputPage {
  spread: Spread;
  /** 'spread': all its pages side by side; else one page ('whole' for a frame). */
  part: 'spread' | PageSide;
}

/** The pages an export makes, in order: one per spread, or one per page (a frame is both). */
export function outputPages(project: Project, per: 'spread' | 'page'): OutputPage[] {
  return allSpreads(project).flatMap((spread): OutputPage[] =>
    per === 'spread' && spread.kind !== 'frame'
      ? [{ spread, part: 'spread' }]
      : pageSides(spread.kind).map((part) => ({ spread, part })),
  );
}

/** A name for an output page, unique within its spread's pages. */
export function slideKey(p: OutputPage): string {
  return `${p.spread.id}:${p.part}`;
}

/** The first `n` pages with photos on them, by key, in order. */
export function firstNonEmpty(pages: readonly OutputPage[], sheet: Sheet, n: number): Set<string> {
  return new Set(
    pages
      .filter((p) => itemsOn(p, sheet).length > 0)
      .slice(0, n)
      .map(slideKey),
  );
}

/** The photos that show on an output page (any part of them). */
export function itemsOn(p: OutputPage, sheet: Sheet): Spread['items'] {
  const region = pageRegion(p, sheet);
  return p.spread.items.filter((i) => intersects(i, region));
}

/** A photo drawn onto an output page. */
export interface Draw {
  photoId: PhotoId;
  /** The part of the photo that shows, in its own upright pixels. */
  src: Rect;
  /** Where that part goes, in output pixels (within the image). */
  dst: Rect;
  /** The whole placed photo, in output pixels, including what's off the image. */
  placed: Rect;
  z: number;
}

export interface PagePlan {
  /** The image's size, in whole pixels. */
  pxW: number;
  pxH: number;
  /** Output pixels per unit: the page's, or less. */
  pxPerUnit: number;
  /** Back to front. Photos entirely off the image are left out. */
  draws: Draw[];
}

/** An output page's area, in its spread's coordinates. */
export function pageRegion(p: OutputPage, sheet: Sheet): Rect {
  if (p.part !== 'spread') return pageRect(p.part, sheet);
  return { x: spreadLeft(p.spread.kind, sheet), y: 0, w: spreadWidth(p.spread.kind, sheet), h: sheet.pageH };
}

/**
 * What to draw for an output page, in output pixels: each photo's visible part, and where
 * it goes. `pxPerUnit` lowers the page's resolution (a smaller image, as for Instagram or a
 * browser's canvas limit); it never raises it, since that would only enlarge the photos.
 */
export function planPage(
  page: OutputPage,
  sheet: Sheet,
  photos: Readonly<Record<PhotoId, PhotoMeta>>,
  pxPerUnit?: number,
): PagePlan {
  const k = Math.min(sheet.pxPerUnit, pxPerUnit ?? Infinity);
  const region = pageRegion(page, sheet);
  const pxW = Math.max(1, Math.round(region.w * k));
  const pxH = Math.max(1, Math.round(region.h * k));
  // Scaled to the whole pixels, so a photo at the page's edge reaches the image's edge.
  const kx = pxW / region.w;
  const ky = pxH / region.h;
  const draws: Draw[] = [];
  for (const item of [...page.spread.items].sort((a, b) => a.z - b.z)) {
    const photo = photos[item.photoId];
    if (!photo) continue;
    const placed = { x: (item.x - region.x) * kx, y: (item.y - region.y) * ky, w: item.w * kx, h: item.h * ky };
    const x1 = Math.max(0, placed.x);
    const y1 = Math.max(0, placed.y);
    const x2 = Math.min(pxW, placed.x + placed.w);
    const y2 = Math.min(pxH, placed.y + placed.h);
    if (x2 <= x1 || y2 <= y1) continue;
    const dst = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    const sx = photo.pxW / placed.w;
    const sy = photo.pxH / placed.h;
    const src = { x: (x1 - placed.x) * sx, y: (y1 - placed.y) * sy, w: dst.w * sx, h: dst.h * sy };
    draws.push({ photoId: item.photoId, src, dst, placed, z: item.z });
  }
  return { pxW, pxH, pxPerUnit: k, draws };
}

/** The largest pxPerUnit, no more than the plan's, whose image has at most `maxPixels`. */
export function fitPixels(plan: PagePlan, maxPixels: number): number {
  const area = plan.pxW * plan.pxH;
  return area <= maxPixels ? plan.pxPerUnit : plan.pxPerUnit * Math.sqrt(maxPixels / area) * 0.999;
}
