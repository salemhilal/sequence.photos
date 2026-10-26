import type { Rect } from './geometry';
import type { ImageInfo } from './imageInfo';
import type { PhotoMeta } from './types';

/**
 * Deciding how a photo goes into a PDF: its original's bytes as they are, when that's a
 * JPEG not much larger than the page needs (no decoding, no canvas, full quality), or else
 * a copy resized to what's needed (see pdf.ts).
 */

/** How much larger than needed an original may be and still go in as it is. */
export const PASS_THROUGH_SLACK = 1.5;

/** Whether to embed the original as it is: a JPEG at most PASS_THROUGH_SLACK times the pixels needed across. */
export function passThrough(info: ImageInfo, photo: Pick<PhotoMeta, 'pxW' | 'crop'>, needW: number): boolean {
  // A cropped photo is drawn at its crop instead (the original would carry what's cut).
  return info.format === 'jpeg' && !photo.crop && photo.pxW <= needW * PASS_THROUGH_SLACK;
}

/** A PDF transformation matrix: (p, q) → (a p + c q + e, b p + d q + f). */
export type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number];

/**
 * Where a point of the stored image (u right, v down, 0 to 1) shows once upright, by EXIF
 * orientation: X right, Y down, 0 to 1.
 */
function upright(orientation: number, u: number, v: number): [number, number] {
  switch (orientation) {
    case 2:
      return [1 - u, v];
    case 3:
      return [1 - u, 1 - v];
    case 4:
      return [u, 1 - v];
    case 5:
      return [v, u];
    case 6:
      return [1 - v, u];
    case 7:
      return [1 - v, 1 - u];
    case 8:
      return [v, 1 - u];
    default:
      return [u, v];
  }
}

/**
 * The matrix that draws a JPEG with an EXIF orientation upright, filling `box` (in PDF
 * points, y up from the page's bottom). PDF draws an image into the unit square with its
 * first row at the top (q = 1), and doesn't apply EXIF orientation itself.
 */
export function orientationMatrix(orientation: number, box: Rect): Matrix {
  const at = (p: number, q: number): [number, number] => {
    const [x, y] = upright(orientation, p, 1 - q);
    return [box.x + x * box.w, box.y + (1 - y) * box.h];
  };
  const [e, f] = at(0, 0);
  const [px, py] = at(1, 0);
  const [qx, qy] = at(0, 1);
  return [px - e, py - f, qx - e, qy - f, e, f];
}
