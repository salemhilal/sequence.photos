import { getImage } from './db';
import { platform } from '#platform';
import { projectStore } from './store';
import { ui } from './ui';
import { createZip, type ZipInput } from './zip';
import type { Frame, Placement } from './types';

const QUALITY = 0.92;

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
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    for (const p of [...frame.items].sort((a, b) => a.z - b.z)) {
      const bitmap = await decode(p);
      if (!bitmap) {
        missing++;
        continue;
      }
      ctx.drawImage(bitmap, p.x, p.y, p.w, p.h);
      bitmap.close();
    }
    const data = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
    files.push({ name: `${String(i + 1).padStart(digits, '0')}.jpg`, data });
    onProgress(i + 1);
  }
  return { files, missing };
}

/**
 * A photo upright and at its placed size. Resizing while decoding looks better than the
 * canvas shrinking a large photo, and keeps only the small copy in memory.
 */
async function decode(p: Placement): Promise<ImageBitmap | null> {
  const img = await getImage(p.photoId);
  if (!img) return null;
  const size = { resizeWidth: Math.max(1, Math.round(p.w)), resizeHeight: Math.max(1, Math.round(p.h)) };
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
    const saved = await platform.saveFile(`sequence-${new Date().toISOString().slice(0, 10)}.zip`, async () => {
      ui.set({ busy: 'Rendering frames…' });
      const out = await renderFrames(frames, frame.w, frame.h, (done) =>
        ui.set({ busy: `Rendering frame ${done} of ${frames.length}…` }),
      );
      missing = out.missing;
      return createZip(out.files);
    });
    if (saved && missing) ui.set({ notice: "Some photos' images were missing, so they're left out." });
  } catch {
    ui.set({ notice: "Couldn't save the images." });
  } finally {
    ui.set({ busy: null });
  }
}
