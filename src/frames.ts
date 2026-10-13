import { getImage } from './db';
import { platform } from '#platform';
import { projectStore } from './store';
import { ui } from './ui';
import { TERMS } from './units';
import { createZip, type ZipInput } from './zip';
import type { Frame, Placement } from './types';

const QUALITY = 0.92;
/** The most pixels a photo is decoded at (Safari's limit is about 16.7 million). */
const MAX_DECODE_PIXELS = 16_000_000;

/**
 * Render a digital sequence's frames as images: one JPEG per frame, at its pixel size, on
 * white, numbered in order (01.jpg, 02.jpg, …) so they upload in sequence. Each photo is
 * drawn from its original, resized once to its placed size, and cropped at the frame's edges.
 */
export async function renderFrames(
  frames: readonly Frame[],
  w: number,
  h: number,
  onProgress: (done: number) => void,
): Promise<{ files: ZipInput[]; missing: number }> {
  const digits = Math.max(2, String(frames.length).length);
  const files: ZipInput[] = [];
  let missing = 0;
  for (const [i, frame] of frames.entries()) {
    const rendered = await renderFrame(frame, w, h);
    missing += rendered.missing;
    const data = await rendered.canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
    files.push({ name: `${String(i + 1).padStart(digits, '0')}.jpg`, data });
    onProgress(i + 1);
  }
  return { files, missing };
}

/**
 * One frame drawn at its pixel size, on white: each photo from its original, resized once
 * to its placed size, and cropped at the frame's edges. `missing` counts photos whose
 * images couldn't be read (left out).
 */
export async function renderFrame(
  frame: Frame,
  w: number,
  h: number,
): Promise<{ canvas: OffscreenCanvas; missing: number }> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  let missing = 0;
  for (const p of [...frame.items].sort((a, b) => a.z - b.z)) {
    // Entirely off the frame: nothing to draw.
    if (p.x >= w || p.y >= h || p.x + p.w <= 0 || p.y + p.h <= 0) continue;
    const bitmap = await decode(p);
    if (!bitmap) {
      missing++;
      continue;
    }
    ctx.drawImage(bitmap, p.x, p.y, p.w, p.h);
    bitmap.close();
  }
  return { canvas, missing };
}

/**
 * A photo upright and at its placed size. Resizing while decoding looks better than the
 * canvas shrinking a large photo, and keeps only the small copy in memory.
 */
async function decode(p: Placement): Promise<ImageBitmap | null> {
  const img = await getImage(p.photoId);
  if (!img) return null;
  // A photo scaled far past its frame would decode huge; Safari (the Mac app) refuses
  // images over about 16 megapixels. Past that it's decoded smaller and drawn scaled up:
  // only that extreme case loses any detail.
  const k = Math.min(1, Math.sqrt(MAX_DECODE_PIXELS / (p.w * p.h)));
  const size = {
    resizeWidth: Math.max(1, Math.round(p.w * k)),
    resizeHeight: Math.max(1, Math.round(p.h * k)),
  };
  for (const source of [img.full, img.thumb]) {
    try {
      return await createImageBitmap(source, { imageOrientation: 'from-image', resizeQuality: 'high', ...size });
    } catch {
      // Not decodable here (e.g. HEIC outside Safari): try the display copy.
    }
  }
  return null;
}

/** Save the frames as a ZIP of JPEGs, reporting progress and errors in the UI. */
export async function saveFrames(): Promise<void> {
  if (ui.get().busy || ui.get().importing) return;
  const { layout } = projectStore.project;
  if (layout.kind !== 'digital') return;
  const { frames, frame } = layout;
  let missing = 0;
  try {
    const saved = await platform.saveFile(
      `${TERMS.digital.fileStem}-${new Date().toISOString().slice(0, 10)}.zip`,
      async () => {
        ui.set({ busy: 'Rendering frames…' });
        const out = await renderFrames(frames, frame.w, frame.h, (done) =>
          ui.set({ busy: `Rendering frame ${done} of ${frames.length}…` }),
        );
        missing = out.missing;
        return createZip(out.files);
      },
    );
    if (saved && missing) ui.set({ notice: "Some photos' images were missing, so they're left out." });
  } catch {
    ui.set({ notice: "Couldn't save the images." });
  } finally {
    ui.set({ busy: null });
  }
}
