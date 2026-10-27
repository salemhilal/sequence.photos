import type { CSSProperties } from 'react';
import { snapPoints, type GuideLines, type Rect, type SnapFeedback } from './geometry';
import type { Crop, PhotoMeta, Sheet } from './types';

/**
 * Cropping: a photo shows only part of its original, the same wherever it is (on the
 * desk or a page), like a trimmed print. The crop is a rectangle in fractions of the
 * upright original; the photo's frame (its placement) has the crop's shape. Nothing of the
 * original is lost: the crop can be changed or reset any time.
 */

/** The whole photo. */
export const WHOLE: Crop = { x: 0, y: 0, w: 1, h: 1 };

/** The smallest crop, as a share of each side, so a photo can't be cropped to nothing. */
export const MIN_CROP = 0.02;

export function cropOf(photo: Pick<PhotoMeta, 'crop'>): Crop {
  return photo.crop ?? WHOLE;
}

/** Whether the crop shows all of the photo. */
export function isWhole(crop: Crop | undefined): boolean {
  return !crop || (crop.x <= 0 && crop.y <= 0 && crop.w >= 1 && crop.h >= 1);
}

/** The pixels of the original that show: the size every layout and resolution works from. */
export function visibleSize(photo: Pick<PhotoMeta, 'pxW' | 'pxH' | 'crop'>): { pxW: number; pxH: number } {
  const c = cropOf(photo);
  return { pxW: photo.pxW * c.w, pxH: photo.pxH * c.h };
}

/** The crop in the original's pixels. */
export function cropPixels(photo: Pick<PhotoMeta, 'pxW' | 'pxH' | 'crop'>): Rect {
  const c = cropOf(photo);
  return { x: c.x * photo.pxW, y: c.y * photo.pxH, w: c.w * photo.pxW, h: c.h * photo.pxH };
}

/**
 * A crop kept inside the photo and no smaller than MIN_CROP, rounded a little so tiny
 * drags don't leave long decimals in the file. None when it's the whole photo.
 */
export function cleanCrop(c: Crop): Crop | undefined {
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  const w = Math.min(1, Math.max(MIN_CROP, c.w));
  const h = Math.min(1, Math.max(MIN_CROP, c.h));
  const x = Math.min(1 - w, Math.max(0, c.x));
  const y = Math.min(1 - h, Math.max(0, c.y));
  const crop = { x: round(x), y: round(y), w: round(w), h: round(h) };
  return isWhole(crop) ? undefined : crop;
}

/**
 * Where the whole photo goes, given its frame (the placement, showing the crop): the
 * frame grown back out to the original, in the frame's units.
 */
export function wholeRect(frame: Rect, crop: Crop): Rect {
  const w = frame.w / crop.w;
  const h = frame.h / crop.h;
  return { x: frame.x - crop.x * w, y: frame.y - crop.y * h, w, h };
}

/** The crop a frame makes of the whole photo placed at `whole` (both in the same units). */
export function cropFrom(frame: Rect, whole: Rect): Crop {
  return {
    x: (frame.x - whole.x) / whole.w,
    y: (frame.y - whole.y) / whole.h,
    w: frame.w / whole.w,
    h: frame.h / whole.h,
  };
}

/**
 * The largest crop of shape `ratio` (width over height, in the photo's pixels) inside the
 * photo, centered on what shows now. For Crop to … in the photo's menu.
 */
export function cropToRatio(photo: Pick<PhotoMeta, 'pxW' | 'pxH' | 'crop'>, ratio: number): Crop | undefined {
  const now = cropPixels(photo);
  const cx = now.x + now.w / 2;
  const cy = now.y + now.h / 2;
  let w = photo.pxW;
  let h = w / ratio;
  if (h > photo.pxH) {
    h = photo.pxH;
    w = h * ratio;
  }
  const x = Math.min(photo.pxW - w, Math.max(0, cx - w / 2));
  const y = Math.min(photo.pxH - h, Math.max(0, cy - h / 2));
  return cleanCrop({ x: x / photo.pxW, y: y / photo.pxH, w: w / photo.pxW, h: h / photo.pxH });
}

/** How the original sits in its frame to show the crop: for an image filling the frame's box. */
export function cropStyle(crop: Crop | undefined): CSSProperties | undefined {
  if (isWhole(crop) || !crop) return undefined;
  return {
    position: 'absolute',
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${(-crop.y / crop.h) * 100}%`,
    width: `${100 / crop.w}%`,
    height: `${100 / crop.h}%`,
    maxWidth: 'none',
  };
}

/** A crop frame's handles: its edges and corners. */
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

interface DragOptions {
  /** Keep this shape (width over height), or none for any. */
  ratio: number | null;
  /** The smallest a side gets, in the frame's units. */
  min: number;
  /** Lines the moving edges snap to (the spread editor's guides), within `threshold`. */
  lines?: GuideLines | null;
  threshold?: number;
}

/**
 * Drag a crop frame's handle by (dx, dy): the edges it holds move, inside the whole photo
 * (which stays put), snapping to `lines`. With a ratio, the frame keeps its shape: a corner
 * anchors the opposite one, an edge stays centered on its axis. Returns the snapped lines too.
 */
export function dragCropHandle(
  start: Rect,
  whole: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  { ratio, min, lines = null, threshold = 0 }: DragOptions,
): { frame: Rect; hit: SnapFeedback } {
  const hit: SnapFeedback = { xs: [], ys: [] };
  const snap = (v: number, axis: 'xs' | 'ys') => {
    if (!lines) return v;
    const s = snapPoints([v], lines[axis], threshold);
    if (s.line !== null) hit[axis].push(s.line);
    return v + s.delta;
  };
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  const wholeRight = whole.x + whole.w;
  const wholeBottom = whole.y + whole.h;
  let x1 = start.x;
  let y1 = start.y;
  let x2 = right;
  let y2 = bottom;
  if (handle.includes('w')) x1 = Math.min(right - min, Math.max(whole.x, snap(start.x + dx, 'xs')));
  if (handle.includes('e')) x2 = Math.max(start.x + min, Math.min(wholeRight, snap(right + dx, 'xs')));
  if (handle.includes('n')) y1 = Math.min(bottom - min, Math.max(whole.y, snap(start.y + dy, 'ys')));
  if (handle.includes('s')) y2 = Math.max(start.y + min, Math.min(wholeBottom, snap(bottom + dy, 'ys')));
  if (ratio === null) return { frame: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, hit };

  // Keeping the shape: size from the dragged edges (a corner, whichever moved more).
  let w = x2 - x1;
  let h = y2 - y1;
  const horizontal = handle === 'e' || handle === 'w';
  const vertical = handle === 'n' || handle === 's';
  if (horizontal || (!vertical && Math.abs(w - start.w) / start.w >= Math.abs(h - start.h) / start.h)) h = w / ratio;
  else w = h * ratio;
  // Where it grows from: the opposite corner, or for an edge, the middle of the other axis.
  const ax = handle.includes('w') ? right : handle.includes('e') ? start.x : start.x + start.w / 2;
  const ay = handle.includes('n') ? bottom : handle.includes('s') ? start.y : start.y + start.h / 2;
  const fx = handle.includes('w') ? 1 : handle.includes('e') ? 0 : 0.5;
  const fy = handle.includes('n') ? 1 : handle.includes('s') ? 0 : 0.5;
  // As large as asked, if the photo has room on each side of the anchor.
  const room = Math.min(
    fx > 0 ? (ax - whole.x) / (w * fx) : Infinity,
    fx < 1 ? (wholeRight - ax) / (w * (1 - fx)) : Infinity,
    fy > 0 ? (ay - whole.y) / (h * fy) : Infinity,
    fy < 1 ? (wholeBottom - ay) / (h * (1 - fy)) : Infinity,
    1,
  );
  w *= room;
  h *= room;
  return { frame: { x: ax - w * fx, y: ay - h * fy, w, h }, hit: { xs: [], ys: [] } };
}

/** Move the photo behind its crop frame by (dx, dy), as far as the frame stays on it. */
export function panCrop(frame: Rect, whole: Rect, dx: number, dy: number): Rect {
  const x = Math.min(frame.x, Math.max(frame.x + frame.w - whole.w, whole.x + dx));
  const y = Math.min(frame.y, Math.max(frame.y + frame.h - whole.h, whole.y + dy));
  return { ...whole, x, y };
}

/** The largest frame of shape `ratio` on the whole photo, centered on the frame now. */
export function frameToRatio(frame: Rect, whole: Rect, ratio: number): Rect {
  let w = whole.w;
  let h = w / ratio;
  if (h > whole.h) {
    h = whole.h;
    w = h * ratio;
  }
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  return {
    x: Math.min(whole.x + whole.w - w, Math.max(whole.x, cx - w / 2)),
    y: Math.min(whole.y + whole.h - h, Math.max(whole.y, cy - h / 2)),
    w,
    h,
  };
}

/** The page's shape, for crop mode's Page choice ("Frame" for frames). */
export function pageShape(sheet: Pick<Sheet, 'arrangement' | 'pageW' | 'pageH'>): { label: string; ratio: number } {
  return { label: sheet.arrangement === 'frames' ? 'Frame' : 'Page', ratio: sheet.pageW / sheet.pageH };
}
