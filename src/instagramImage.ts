import { renderFrame } from './frames';
import type { Rect } from './geometry';
import type { Frame, Size } from './types';

/**
 * A digital sequence's frames as the images Instagram takes: its shapes and sizes, and
 * its limits on a post. Posting them is in instagramPost.ts.
 */

export type PostKind = 'feed' | 'story';
/** How a frame outside the feed's shapes is fitted: trimmed, or given margins. */
export type Fit = 'crop' | 'expand';

/** Instagram's API limits. */
export const LIMITS = {
  /** Feed images: portrait 4:5 to landscape 1.91:1. */
  minRatio: 4 / 5,
  maxRatio: 1.91,
  /** Images per carousel. (The Instagram app allows 20; the API, 10.) */
  maxItems: 10,
  minWidth: 320,
  maxWidth: 1440,
  /** Sequence's server refuses taller images. */
  maxHeight: 2560,
  /** Instagram's limit per image, and the server's. */
  maxBytes: 8 * 1024 * 1024,
  captionLength: 2200,
  hashtags: 30,
};

/** An image as posted: its size, the part of the frame it shows, and where that goes. */
export interface PostImageLayout {
  width: number;
  height: number;
  /** The part of the frame shown, in frame pixels. */
  source: Rect;
  /** Where it's drawn, in image pixels (the rest is white). */
  target: Rect;
}

/**
 * The shapes Instagram takes, as width / height: feed images from 4:5 (tall) to 1.91:1
 * (wide); stories any shape Sequence's server takes once scaled to Instagram's widths
 * (no taller than 320 × 2560).
 */
function ratioRange(kind: PostKind): { min: number; max: number } {
  return kind === 'feed'
    ? { min: LIMITS.minRatio, max: LIMITS.maxRatio }
    : { min: LIMITS.minWidth / LIMITS.maxHeight, max: Infinity };
}

/** Whether a frame of this size can be posted as it is. */
export function fits(size: Size, kind: PostKind): boolean {
  const { min, max } = ratioRange(kind);
  const r = size.w / size.h;
  return r >= min - 1e-9 && r <= max + 1e-9;
}

/** The nearest shape Instagram takes, as width / height. */
export function targetRatio(size: Size, kind: PostKind): number {
  const { min, max } = ratioRange(kind);
  return Math.min(max, Math.max(min, size.w / size.h));
}

/** A ratio as people say it: 4:5, 1.91:1, or 3:4. */
export function ratioLabel(r: number): string {
  for (const [a, b] of [
    [4, 5],
    [3, 4],
    [1, 1],
    [9, 16],
    [16, 9],
    [2, 3],
    [3, 2],
  ] as const) {
    if (Math.abs(r - a / b) < 0.005) return `${a}:${b}`;
  }
  return `${Math.round(r * 100) / 100}:1`;
}

/**
 * How a frame becomes an image for Instagram. A frame outside the shapes Instagram takes
 * (see ratioRange) is cropped (centered) or expanded with white margins to the nearest
 * one. Then the image is scaled to Instagram's widths (320 to 1440 px) and the server's
 * height limit, rounding so it stays within the allowed shapes.
 */
export function postImageLayout(size: Size, kind: PostKind, fit: Fit): PostImageLayout {
  let source: Rect = { x: 0, y: 0, w: size.w, h: size.h };
  let canvas = { w: size.w, h: size.h };
  const r = targetRatio(size, kind);
  if (!fits(size, kind)) {
    const tall = size.w / size.h < r;
    if (fit === 'crop') {
      source = tall
        ? { x: 0, y: (size.h - size.w / r) / 2, w: size.w, h: size.w / r }
        : { x: (size.w - size.h * r) / 2, y: 0, w: size.h * r, h: size.h };
      canvas = { w: source.w, h: source.h };
    } else {
      canvas = tall ? { w: size.h * r, h: size.h } : { w: size.w, h: size.w / r };
    }
  }
  const scale = Math.max(
    LIMITS.minWidth / canvas.w,
    Math.min(1, LIMITS.maxWidth / canvas.w, LIMITS.maxHeight / canvas.h),
  );
  let width = Math.round(canvas.w * scale);
  let height = Math.round(canvas.h * scale);
  // Rounding mustn't tip the image past an allowed shape (e.g. 1003 × 1254 is under 4:5).
  const { min, max } = ratioRange(kind);
  if (width / height < min) height = Math.floor(width / min);
  if (width / height > max) width = Math.floor(height * max);
  height = Math.min(height, LIMITS.maxHeight);
  const w = Math.min(width, source.w * scale);
  const h = Math.min(height, source.h * scale);
  return { width, height, source, target: { x: (width - w) / 2, y: (height - h) / 2, w, h } };
}

/** Lower qualities to try, in turn, until an image is under Instagram's size limit. */
const QUALITIES = [0.92, 0.85, 0.75, 0.6];

/** One frame as the JPEG Instagram gets, or null if it can't fit Instagram's size limit. */
export async function renderPostImage(frame: Frame, size: Size, layout: PostImageLayout): Promise<Blob | null> {
  const { canvas: rendered } = await renderFrame(frame, size.w, size.h);
  const out = new OffscreenCanvas(layout.width, layout.height);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.imageSmoothingQuality = 'high';
  const { source: s, target: t } = layout;
  ctx.drawImage(rendered, s.x, s.y, s.w, s.h, t.x, t.y, t.w, t.h);
  for (const quality of QUALITIES) {
    const blob = await out.convertToBlob({ type: 'image/jpeg', quality });
    if (blob.size <= LIMITS.maxBytes) return blob;
  }
  return null;
}

/** Hashtags in a caption (Instagram allows 30). */
export function hashtagCount(caption: string): number {
  return caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;
}
