import { useSyncExternalStore } from 'react';
import { getImage, putImage } from './db';
import type { PhotoMeta } from './types';
import { DESK_PHOTO_PX } from './geometry';
import { newPhotoId } from './ids';

/** The preview's longest side: also a desk photo's size at 100% (see DESK_PHOTO_PX). */
const THUMB_MAX = DESK_PHOTO_PX;

const urls = new Map<string, string>();
const loading = new Set<string>();
/** Photos whose image isn't stored, or won't decode. */
const missing = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Show `blob` as the photo's display image. */
export function setUrl(id: string, blob: Blob): void {
  const old = urls.get(id);
  if (old) URL.revokeObjectURL(old);
  urls.set(id, URL.createObjectURL(blob));
  missing.delete(id);
  emit();
}

/** Show an image that isn't stored in the project (e.g. the tour's sample photos). */
export function showUrl(id: string, url: string): void {
  urls.set(id, url);
  emit();
}

async function load(id: string): Promise<void> {
  if (loading.has(id) || urls.has(id)) return;
  loading.add(id);
  try {
    const img = await getImage(id);
    if (img) setUrl(id, img.thumb);
    else markMissing(id);
  } finally {
    loading.delete(id);
  }
}

export function usePhotoUrl(id: string): string | undefined {
  const url = useSyncExternalStore(subscribe, () => urls.get(id));
  if (url === undefined && !missing.has(id)) void load(id);
  return url;
}

/** Whether a photo's image couldn't be found or read. */
export function usePhotoMissing(id: string): boolean {
  return useSyncExternalStore(subscribe, () => missing.has(id));
}

/** Record that a photo's image can't be shown (not stored, or it won't decode). */
export function markMissing(id: string): void {
  if (missing.has(id)) return;
  missing.add(id);
  emit();
}

export function forgetUrl(id: string): void {
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  missing.delete(id);
}

/**
 * A photo's original as PNG (the image type browsers can reliably put on the
 * clipboard), upright per its EXIF orientation. Falls back to the display copy
 * if the original can't be decoded.
 */
export async function photoAsPng(id: string): Promise<Blob> {
  const img = await getImage(id);
  if (!img) throw new Error('Image not found');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(img.full, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(img.thumb);
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/png' });
}

/** Decode an image file (applying EXIF orientation) and make its display-size copy. */
export async function thumbFromBlob(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    return await makeThumb(bitmap);
  } finally {
    bitmap.close();
  }
}

async function makeThumb(bitmap: ImageBitmap): Promise<Blob> {
  const scale = Math.min(1, THUMB_MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

export interface ImportResult {
  photos: PhotoMeta[];
  failed: string[];
}

/** Decode, thumbnail, and store files. EXIF orientation is applied by createImageBitmap. */
export async function importFiles(
  files: File[],
  onProgress: (done: number, total: number) => void,
): Promise<ImportResult> {
  const sorted = [...files]
    .filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|heic)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const photos: PhotoMeta[] = [];
  const failed: string[] = [];
  let done = 0;
  onProgress(0, sorted.length);

  // A few at a time keeps memory bounded for large batches.
  const queue = [...sorted];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const thumb = await makeThumb(bitmap);
        const meta: PhotoMeta = { id: newPhotoId(), name: file.name, pxW: bitmap.width, pxH: bitmap.height };
        bitmap.close();
        await putImage(meta.id, { full: file, thumb });
        setUrl(meta.id, thumb);
        photos.push(meta);
      } catch {
        failed.push(file.name);
      }
      onProgress(++done, sorted.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  const order = new Map(sorted.map((f, i) => [f.name, i]));
  photos.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
  return { photos, failed };
}
