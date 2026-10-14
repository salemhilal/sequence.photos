import { folioLabel } from './actions';
import { getImage } from './db';
import type { PhotoId } from './ids';
import { platform } from '#platform';
import { fitPixels, outputPages, planPage, type OutputPage, type PagePlan } from './renderPlan';
import { allSpreads, sheetOf } from './spreads';
import { projectStore } from './store';
import type { PhotoMeta, Project } from './types';
import { ask, ui } from './ui';
import { TERMS } from './units';
import { createZip, type ZipInput } from './zip';

const QUALITY = 0.92;
/** The most pixels a photo is decoded at (Safari's limit is about 16.7 million). */
const MAX_DECODE_PIXELS = 16_000_000;
/** The most pixels one canvas holds: Safari (the Mac app) refuses larger ones. */
export const MAX_CANVAS_PIXELS = 16_000_000;

/**
 * An output page drawn from its plan, on white: each photo from its original, resized once
 * to its placed size, and cropped at the image's edges. `missing` counts photos whose
 * images couldn't be read (left out).
 */
export async function renderPage(
  plan: PagePlan,
  photos: Readonly<Record<PhotoId, PhotoMeta>>,
): Promise<{ canvas: OffscreenCanvas; missing: number }> {
  const canvas = new OffscreenCanvas(plan.pxW, plan.pxH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, plan.pxW, plan.pxH);
  ctx.imageSmoothingQuality = 'high';
  let missing = 0;
  for (const d of plan.draws) {
    const photo = photos[d.photoId];
    const bitmap = photo && (await decodePhoto(d.photoId, photo, d.placed.w, d.placed.h))?.bitmap;
    if (!photo || !bitmap) {
      missing++;
      continue;
    }
    // The plan's source is in the photo's own pixels; the bitmap may be smaller.
    const kx = bitmap.width / photo.pxW;
    const ky = bitmap.height / photo.pxH;
    const { src, dst } = d;
    ctx.drawImage(bitmap, src.x * kx, src.y * ky, src.w * kx, src.h * ky, dst.x, dst.y, dst.w, dst.h);
    bitmap.close();
  }
  return { canvas, missing };
}

/**
 * A photo upright and at its placed size (w × h output pixels). Resizing while decoding
 * looks better than the canvas shrinking a large photo, and keeps only the small copy in
 * memory. `preview` says the original couldn't be decoded, so its display copy was used.
 */
export async function decodePhoto(
  id: PhotoId,
  meta: PhotoMeta,
  w: number,
  h: number,
): Promise<{ bitmap: ImageBitmap; preview: boolean } | null> {
  const img = await getImage(id);
  if (!img) return null;
  // Decoded at its placed size, but never past the photo's own resolution (an enlarged
  // photo has no more detail to give, so drawing it larger loses nothing), nor past about
  // 16 megapixels, which Safari (the Mac app) refuses. A photo scaled far past its page
  // would otherwise decode huge, mostly for the parts cropped off.
  const own = Math.min(1, meta.pxW / w, meta.pxH / h);
  const k = Math.min(own, Math.sqrt(MAX_DECODE_PIXELS / (w * h)));
  const size = { resizeWidth: Math.max(1, Math.round(w * k)), resizeHeight: Math.max(1, Math.round(h * k)) };
  for (const source of [img.full, img.thumb]) {
    try {
      const bitmap = await createImageBitmap(source, {
        imageOrientation: 'from-image',
        resizeQuality: 'high',
        ...size,
      });
      return { bitmap, preview: source === img.thumb };
    } catch {
      // Not decodable here (e.g. HEIC outside Safari): try the display copy.
    }
  }
  return null;
}

/** Each output page's file name: its page numbers, zero-padded, with spreads as "02-03". */
export function imageNames(project: Project, pages: readonly OutputPage[]): string[] {
  const arrangement = project.layout.kind;
  const spreads = allSpreads(project);
  if (pages.every((p) => p.part === 'spread')) {
    return pages.map(
      (p) => `${folioLabel(spreads.indexOf(p.spread), spreads.length, arrangement).replace('–', '-')}.jpg`,
    );
  }
  const digits = Math.max(2, String(pages.length).length);
  return pages.map((_, i) => `${String(i + 1).padStart(digits, '0')}.jpg`);
}

/**
 * Render output pages as JPEGs, named in order, at the page's resolution: or, for a page
 * too large for one canvas, at the largest that fits (`lowest` is the least pxPerUnit used).
 */
export async function renderImages(
  pages: readonly OutputPage[],
  project: Project,
  onProgress: (done: number) => void,
): Promise<{ files: ZipInput[]; missing: number; lowest: number }> {
  const sheet = sheetOf(project);
  const names = imageNames(project, pages);
  const files: ZipInput[] = [];
  let missing = 0;
  let lowest = sheet.pxPerUnit;
  for (const [i, page] of pages.entries()) {
    let plan = planPage(page, sheet, project.photos);
    const fits = fitPixels(plan, MAX_CANVAS_PIXELS);
    if (fits < plan.pxPerUnit) plan = planPage(page, sheet, project.photos, fits);
    lowest = Math.min(lowest, plan.pxPerUnit);
    const rendered = await renderPage(plan, project.photos);
    missing += rendered.missing;
    const data = await rendered.canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
    files.push({ name: names[i] ?? `${i + 1}.jpg`, data });
    onProgress(i + 1);
  }
  return { files, missing, lowest };
}

/**
 * File → Export images: a ZIP of JPEGs, one per frame, or (for spreads, as asked) one per
 * spread or per page. Reports progress and problems in the UI.
 */
export async function exportImages(): Promise<void> {
  if (ui.get().busy || ui.get().importing) return;
  const project = projectStore.project;
  let per: 'spread' | 'page' = 'page';
  if (project.layout.kind === 'spreads') {
    const answer = await ask({
      title: 'Export images',
      message: 'One image for each spread, or one for each page?',
      actions: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'One per spread', value: 'spread' },
        { label: 'One per page', value: 'page', primary: true },
      ],
    });
    if (answer === null || answer === 'cancel') return;
    per = answer;
  }
  const pages = outputPages(project, per);
  const sheet = sheetOf(project);
  let missing = 0;
  let lowest = sheet.pxPerUnit;
  try {
    const saved = await platform.saveFile(
      `${TERMS[sheet.arrangement].fileStem}-${new Date().toISOString().slice(0, 10)}.zip`,
      async () => {
        ui.set({ busy: 'Rendering images…' });
        const out = await renderImages(pages, project, (done) =>
          ui.set({ busy: `Rendering image ${done} of ${pages.length}…` }),
        );
        missing = out.missing;
        lowest = out.lowest;
        return createZip(out.files);
      },
    );
    if (!saved) return;
    if (missing) ui.set({ notice: "Some photos' images were missing, so they're left out." });
    else if (lowest < sheet.pxPerUnit) {
      ui.set({
        notice:
          sheet.unit === 'in'
            ? `Some pages were exported at ${Math.floor(lowest)} dpi, the most this browser can make in one image.`
            : `Some pages were exported at ${Math.floor(lowest * 100)}% of their size, the most this browser can make in one image.`,
      });
    }
  } catch {
    ui.set({ notice: "Couldn't export the images." });
  } finally {
    ui.set({ busy: null });
  }
}
