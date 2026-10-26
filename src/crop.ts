import type { CSSProperties } from 'react';
import type { Rect } from './geometry';
import type { Crop, PhotoMeta } from './types';

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
